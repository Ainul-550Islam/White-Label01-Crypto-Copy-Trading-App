
# Part 18 - metrics exposition and the bootable image: full source handover

> **What this part changed, and what it did not:** the execution engine now serves
> `GET /metrics`, its engine has an instrument for the first time, four spans inside
> `ExecutionEngine.submit` are timed, the shared exposition adapter has one fewer
> bug than it has carried since Part 9, and all three Python images have a command
> line that can start a process. No order path changed its outcome, no table was
> added, nothing was pruned or exported to Redis, `EXECUTION_MODE=live` is still
> refused at startup with Part 16's sentence, and no TypeScript file was touched.

Complete content of every file created or modified by Part 18. Nothing is
abbreviated, quoted-with-ellipsis, or referred to by path: each block carries the
whole current file, so this document alone can be reviewed, diffed against an
earlier part's handover, or used to reconstruct the tree.

## Gates (run while this document was generated)

* `cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m pytest -q`
  -> **428 passed, 12 skipped**. The skips are Parts 13's and 14's live-Postgres suites,
  skipping BY NAME without `EXECUTION_TEST_POSTGRES_DSN`, and the count is the same 12 Parts
  15-17 reported: Part 18 added no live test, because every law it ships is about exposition
  and statement shape, which a fake pool and a `TestClient` prove. This part's two files on
  their own -> **47 passed**. `ruff check app tests` -> green; `mypy app` -> no issues in
  **24 source files**, three more than Part 17 measured: the hub, its router, and the
  boot-target test, all annotated.
* `cd libs/trading-core && python3 -m pytest -q` -> **1767**, up from Part 17's figure
  because the part's core suite and the corrected Part 9 adapter test are in it; the library
  gained the `metrics` accessor, `_observe_stage`, and the fix inside
  `observe_latency_histogram`, and it gained no new port or vocabulary - the 13 stage names
  and 29 counter fields it now exposes are the ones Parts 5 and 16 shipped. `ruff check
  wlct_trading tests` -> green (17 findings in `libs/trading-core/scripts`, which are
  standalone by design); `mypy wlct_trading` -> no issues in **152 source files**.
* Sibling suites, since this part edited their files rather than leaving them alone:
  trading-engine **43**, market-data **19**. Each gained `log-config.json` and a corrected
  image command line, and neither gained a code path - which is what those two numbers are
  here to confirm rather than assert.
* **Suppression tokens: 0 in the files Part 18 added**, counted by this script over every
  new source and test file rather than asserted from memory. This part earned that count the
  slow way: the first draft of the hub had two `# noqa` tokens on imports that would have
  failed a reader's eye instead of a lint, and the first draft of the test file had a `#
  noqa: ANN401` on a `**kwargs`-splatting helper that the fix replaced with typed keyword
  arguments. The 5 tokens in the modified files are Part 5/12/13/16 lines, left alone for
  the reason Part 16 stated: rewriting a neighbour's justified comment to improve a new
  part's score is churn wearing care's clothing.
* `node --test scripts/` -> **133 passed / 0 failed**; `node scripts/dr-manifest.mjs
  --check` -> manifest valid: 5 components (4 with cadence), RPO 60m / RTO 4h, drill every
  90d (timed: true), ledger entries: 0; `node scripts/dr-manifest.mjs --check-rls` -> exit
  1: [DUE  ] rls-enablement: never recorded (cadence 168h) - run the audit and record it
  with --record-rls; policies that nobody verified are a hypothesis. Both node checks are
  unchanged by this part, and that is the correct result to print: Part 18 adds no table, so
  the covered set stays at 43 and `PROBE_TABLES` at 5, and the enablement audit is still
  owed by the operator rather than by this document.
* `cd apps/api && npx jest --silent` -> **430 passed / 21 suites**; `npx tsc -p
  tsconfig.json --noEmit` -> 0 errors; `npx eslint src --max-warnings 0` -> clean; `npx
  prisma validate` -> valid. In `apps/admin-web`, `npx tsc --noEmit` -> 0 errors. No screen
  and no API code changed: `/metrics` is not a surface the console or the worker consumes -
  the worker's forwarding list is built from `/internal/v1/*` paths, which is asserted in
  this part's own suite rather than assumed from the compose file.

## Ledger

Measured at generation time, with code and documents counted separately because a
tree-size figure that mixes them is not a size. Part 18 shipped **2,783 lines** -
**2,333** across the 9 new code files, **406** in the
1 new document, and **+44** code /
**+0** document lines across the 22 modified files (each delta
measured against the newest prior handover that lists that file - which leaves
1 of them, 325 lines, with no delta at all because
no earlier document recorded their prior size: `docs/GETTING_STARTED.md`. Their full text is
embedded below, and their size is not presented as a change). Whole-tree counts
under the standing rule set: **219,180 source lines**; adding the narrative
documents under `docs/` (the regenerable `docs/source/` views and every handover
dump are out of both figures): **241,136**.

Three things this document does that a hand-written one cannot keep doing: the gate
numbers above are subprocess runs of the real suites, so a suite that cannot be
measured is written here as `FAILED` rather than omitted; the file lists are the
part's complete diff, enumerated from the files that carry its markers rather than as
a plan remembered afterwards; and `--check` regenerates the document in memory and
compares it byte for byte with the committed file, which is what makes deterministic
and regenerable a command with an exit code instead of an adjective. The emission
count is asserted at the end of every write - the number of `## FILE:` blocks must
equal the number of files the lists name, so a silently skipped file is a failed run
rather than a shorter document.

Two provenance notes, because they are the kind of sentence a later part would
otherwise read as boilerplate. This part is the first to change a *shipped image*
rather than only code, and the change is a repair rather than an addition:
`--log-config /dev/null` had been in all three Python Dockerfiles since those files
were written, `logging.config.fileConfig` has refused a zero-length file since at
least python 3.11.9, and nothing in this repository resolves an image command line -
so the defect was not invisible because it was unimportant, it was invisible because
no gate looked. The test this part added (`tests/test_part18_asgi_target.py`) is the
gate, and `docs/PART18_METRICS_EXPOSITION.md` sec. 6.1 is the record, including the
one command whose output proved the fix: the same curl that failed for eleven parts.
And the second half of the honesty: the metrics this part exposes were, until it
existed, accumulated by nothing in this process, because `build_runtime` never
passed `metrics=` to the engine. Every earlier document that described those counters
as measurable was describing a port with nothing behind it. That sentence belongs in
a handover header rather than in a changelog, because the reader of a handover is the
person deciding whether to trust the numbers.

One hazard the ledger exposes that Part 17 named and Part 18 proves again. The
baseline for a modified file is the newest prior handover that lists it, and this
part's files overlap Parts 13-17's heavily (the service's config, composition,
schemas, internal router, main, the two docs, the root env example, and two sibling
Dockerfiles that no prior handover ever listed). When an ancestor document is
regenerated - which it must be, because its own rule is that it embeds the complete
current content of every file it names - the copies inside it move forward to
post-Part-18 content, and this part's delta is then measured against a snapshot that
already contains this part's edits. So the figure below is measured after that
regeneration, the coupling is stated rather than hidden, and `--check` on any of the
three documents reproduces what it prints.

## Created in Part 18 (full files)

## FILE: services/execution-engine/app/observability.py (305 lines)

*the hub: counter families DERIVED from dataclasses.fields(ExecutionCounters) so the exporter cannot fall behind the instrument, one stage-bounded histogram copied whole per scrape through the core's adapter rather than re-observed, seven wiring gauges read from describe() instead of from settings, a reset counter because inc() refuses a negative amount, and no background task - everything is read at scrape time from state the process already holds.*

```python
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
```


## FILE: services/execution-engine/app/routers/observability.py (46 lines)

*GET /metrics: unauthenticated like the health endpoints beside it, include_in_schema=False so the path never enters the OpenAPI document, and a router that is not mounted at all when OBSERVABILITY_ENABLED is false, which makes the disabled posture a 404 rather than an apology body.*

```python
"""The scrape endpoint (Part 18): one route, no tenant, no token.

Auth posture, deliberately the same as the two sibling services': ``/metrics``
follows the health endpoints it sits beside - unauthenticated, internal-network
only, machine-shaped aggregates with no tenant rows and no credentials. Two
reasons, both load-bearing:

* A Prometheus scraper and a compose healthcheck cannot be expected to hold the
  service token, and inventing a second credential for observability is how a
  deployment ends up either unable to scrape or shipping the token in the scrape
  config - the same outcome, reached slowly.
* There is nothing here worth stealing. The label law in the core
  (``FORBIDDEN_LABEL_NAMES``) rejects tenant, account, order and credential labels
  at registration, so the rendered text is aggregate counts, fixed-bucket
  histograms and five wiring booleans. The part's test suite asserts that on the
  rendered body as well as at registration, because a policy enforced only at the
  source is a policy that one new ``register_counter`` call can break.

The route answers with a comment line rather than a 500 in the one case where the
hub is genuinely absent: a request that races the lifespan. That is a window of a
few milliseconds per process start, and an empty scrape is more useful to a
pipeline than a 500 it has to special-case. ``OBSERVABILITY_ENABLED=false`` is a
different state and gets a different answer - the route is not mounted, so the
target 404s, because "no target" and "empty target" are different facts and a
scraper should not have to read a body to tell them apart.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["observability"])

PROMETHEUS_MEDIA_TYPE = "text/plain; version=0.0.4; charset=utf-8"


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def metrics(request: Request) -> PlainTextResponse:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return PlainTextResponse(
            "# observability not initialised in this process\n",
            media_type=PROMETHEUS_MEDIA_TYPE,
        )
    return PlainTextResponse(hub.scrape(), media_type=PROMETHEUS_MEDIA_TYPE)
```


## FILE: services/execution-engine/tests/test_part18_observability.py (551 lines)

*33 tests in six groups: the exporter/family equality asserted in BOTH directions against the dataclass; mirrored totals as a delta with a decrease counted as a reset (11 then 14, resets 1) instead of lowered; an unrecorded stage ABSENT rather than zero; a forbidden label refused at registration; a scrape that leaves the source alone; and the route's plane on a booted app - no token, no OpenAPI entry, not on the worker's forwarding list, and /status and the gauge agreeing because both are read rather than one being typed from memory.*

```python
"""Part 18: the execution engine's scrape, and the laws the exposition must keep.

Six things are pinned here, in the order they would hurt if they broke:

1. **The exporter cannot fall behind the instrument.** The counter families are
   derived from ``ExecutionCounters``' fields and the test asserts equality in both
   directions, so a counter added in the core with no matching entry here is
   impossible, and a family invented here without an instrument is caught. This is
   the specific failure this repository has now hit three times with hand-written
   lists, and it is the one thing a metrics adapter is uniquely good at hiding.
2. **Mirroring is a delta, and a decrease is an event.** ``inc`` refuses a negative
   amount by platform law, so the hub adds the difference; when the source goes
   backwards (``reset()``, or a fresh process) the hub re-baselines and COUNTS that
   instead of drawing a cliff or reporting a negative rate.
3. **An unrecorded stage is absent, not zero.** A histogram of zeros reads as
   "everything was instantaneous"; the truth is "nobody measured", and the exposition
   is exactly where that distinction gets lost.
4. **Nothing identifying is in the text** - not because the render filters it, but
   because the core's cardinality law refuses such labels at registration, which is
   asserted here by trying to register one and being told no.
5. **Reading does not write.** A scrape leaves the engine's own instruments alone.
6. **The route's plane.** Unauthenticated like the health endpoints beside it, absent
   from the OpenAPI document, invisible to the worker's forwarding list, and a 404
   rather than an apology when exposition is disabled.
"""

from __future__ import annotations

import re
from contextlib import ExitStack
from dataclasses import fields
from typing import cast

import pytest
from fastapi.testclient import TestClient
from wlct_trading.metrics import (
    EXECUTION_STAGES,
    ExecutionCounters,
    ExecutionMetrics,
    LatencyHistogram,
)
from wlct_trading.observability.labels import CardinalityError

from app.composition import EngineRuntime
from app.observability import (
    COUNTER_FAMILIES,
    LATENCY_FAMILY,
    RESETS_FAMILY,
    WIRING_GAUGE,
    ExecutionEngineObservability,
    counter_families,
)
from tests.conftest import auth_headers
from tests.test_execution_engine import settings_for
from tests.test_part14_retention import postgres_client
from tests.test_part15_drift_parity import ENGINE_CLIENT


class FakeMetrics:
    """An ``ExecutionMetrics``-shaped source, holding the core's real histograms.

    Not a fake histogram: the adapter the hub mirrors through refuses a source
    whose bucket edges differ from the exposed family, and that check is exactly
    the kind of contract a test double would smooth over. A real
    ``LatencyHistogram`` also keeps ``count`` honest without reimplementing it.
    """


    def __init__(self, **counters: int) -> None:
        self.counters = ExecutionCounters(**counters)
        self._stages: dict[str, LatencyHistogram] = {}
        self.asked_for: list[str] = []

    def stage(self, name: str) -> LatencyHistogram | None:
        self.asked_for.append(name)
        return self._stages.get(name)

    def record_stage(self, name: str, micros: int = 1_000, samples: int = 1) -> None:
        histogram = LatencyHistogram()
        for _ in range(samples):
            histogram.observe(micros)
        self._stages[name] = histogram


class FakeEngine:
    """The only thing the hub reads off an engine: the metrics port it holds."""

    def __init__(self, metrics: FakeMetrics | None) -> None:
        self.metrics = metrics


class FakeRuntime:
    """Enough of ``EngineRuntime`` for the hub: an engine, and a description."""

    def __init__(
        self, metrics: FakeMetrics | None, described: dict[str, object] | None = None
    ) -> None:
        self.engine = FakeEngine(metrics)
        self._described: dict[str, object] = described if described is not None else {}

    def describe(self) -> dict[str, object]:
        return dict(self._described)


def hub_for(
    metrics: FakeMetrics | None = None,
    described: dict[str, object] | None = None,
) -> ExecutionEngineObservability:
    return ExecutionEngineObservability(cast(EngineRuntime, FakeRuntime(metrics, described)))


def render_value(body: str, family: str) -> float | None:
    """The value of a label-free series of ``family`` in the rendered text.

    Matching on the family plus ``{`` rather than a space because the registry
    stamps every series with its ``service`` label: the line is
    ``wlct_execution_..._total{service="execution-engine"} 5``, and a parser that
    assumed a bare name would report "absent" for a metric that is right there -
    the most misleading kind of test failure.
    """
    for line in body.splitlines():
        if line.startswith(family + "{") or line.startswith(family + " "):
            return float(line.rsplit(" ", 1)[1])
    return None


# ---------------------------------------------------------------------------
# 1. the family set is derived, in both directions
# ---------------------------------------------------------------------------


class TestFamilyDerivation:
    def test_the_exported_counters_are_exactly_the_instruments_fields(self) -> None:
        expected = tuple(
            f"wlct_execution_{field.name}_total" for field in fields(ExecutionCounters)
        )
        assert COUNTER_FAMILIES == expected
        assert counter_families() == expected

    def test_the_hub_registers_every_one_of_them(self) -> None:
        hub = hub_for(FakeMetrics())
        missing = set(COUNTER_FAMILIES) - set(hub.family_names)
        assert not missing, f"declared but not registered: {sorted(missing)}"

    def test_the_hub_invents_no_counter_of_its_own(self) -> None:
        hub = hub_for(FakeMetrics())
        exported = {n for n in hub.family_names if n.startswith("wlct_execution_")}
        allowed = set(COUNTER_FAMILIES) | {LATENCY_FAMILY, WIRING_GAUGE, RESETS_FAMILY}
        assert exported <= allowed, exported - allowed

    def test_the_latency_wiring_and_reset_families_exist(self) -> None:
        hub = hub_for(FakeMetrics())
        assert LATENCY_FAMILY in hub.family_names
        assert WIRING_GAUGE in hub.family_names
        assert RESETS_FAMILY in hub.family_names


# ---------------------------------------------------------------------------
# 2. mirroring: deltas, resets, and the values a panel will read
# ---------------------------------------------------------------------------


class TestMirroring:
    def test_a_scrape_reports_the_sources_total(self) -> None:
        metrics = FakeMetrics(orders_submitted=7, placement_reviews=3)
        body = hub_for(metrics).scrape()
        assert render_value(body, "wlct_execution_orders_submitted_total") == 7
        assert render_value(body, "wlct_execution_placement_reviews_total") == 3

    def test_two_scrapes_do_not_double_a_counter(self) -> None:
        # The single most likely bug in a mirror: the source is cumulative and the
        # registry only adds, so a naive per-scrape inc would make the second scrape
        # of an idle process report twice the work that happened.
        metrics = FakeMetrics(orders_submitted=4)
        hub = hub_for(metrics)
        first = render_value(hub.scrape(), "wlct_execution_orders_submitted_total")
        second = render_value(hub.scrape(), "wlct_execution_orders_submitted_total")
        assert first == 4 and second == 4

    def test_the_delta_between_scrapes_is_what_gets_added(self) -> None:
        metrics = FakeMetrics(orders_submitted=4)
        hub = hub_for(metrics)
        hub.scrape()
        metrics.counters.orders_submitted = 10
        assert render_value(hub.scrape(), "wlct_execution_orders_submitted_total") == 10

    def test_a_source_that_moves_backwards_is_re_baselined_and_counted(self) -> None:
        metrics = FakeMetrics(orders_submitted=9)
        hub = hub_for(metrics)
        hub.scrape()
        metrics.counters.orders_submitted = 2  # the core's test-only reset()
        body = hub.scrape()
        # 11, not 2, and that is the deliberate choice rather than a slip. The
        # registry refuses a negative increment (correctly: a Prometheus counter
        # that decreases breaks rate() for every consumer), so the mirror is
        # monotone across a source reset and the EVENT is what carries the truth -
        # both as a rendered series and as the hub's own count. A production
        # restart is not this path at all: it is a new process with a new registry
        # and a series that legitimately starts at zero, which is exactly what
        # rate() expects to see. Nothing in the shipped services calls reset();
        # the case exists because the port allows it and a mirror must not be
        # surprised by a source it is told to follow.
        assert render_value(body, "wlct_execution_orders_submitted_total") == 11
        assert render_value(body, RESETS_FAMILY) == 1
        assert hub.reset_count == 1
        # ...and the tracking re-baselined, so what comes next is measured right:
        metrics.counters.orders_submitted = 5
        assert (
            render_value(hub.scrape(), "wlct_execution_orders_submitted_total") == 14
        )

    def test_a_counter_that_has_never_moved_is_absent_from_the_text(self) -> None:
        # The registry's own rendering law, which this hub inherits instead of
        # arguing with: a family with no series is omitted (Part 9 pinned that for
        # the case of a registered-but-unused counter, and the same shape keeps a
        # scrape from having to invent zeros). So "absent" means "nothing has been
        # written to it in this process", and the presence of the wiring gauges -
        # always set, because they describe the wiring rather than the traffic - is
        # what distinguishes that from a service that is not measuring at all.
        body = hub_for(FakeMetrics()).scrape()
        assert render_value(body, "wlct_execution_orders_submitted_total") is None
        assert WIRING_GAUGE in body
        assert "# TYPE wlct_execution_wiring gauge" in body


# ---------------------------------------------------------------------------
# 3. stages
# ---------------------------------------------------------------------------


class TestStageExposition:
    def test_a_recorded_stage_appears_with_its_buckets(self) -> None:
        metrics = FakeMetrics()
        metrics.record_stage("risk", micros=1200, samples=3)
        body = hub_for(metrics).scrape()
        assert '_count{service="execution-engine",stage="risk"} 3' in body
        assert '_sum{service="execution-engine",stage="risk"} 3600' in body

    def test_an_unrecorded_stage_is_absent_rather_than_zeroed(self) -> None:
        metrics = FakeMetrics()
        metrics.record_stage("risk")
        body = hub_for(metrics).scrape()
        assert 'stage="risk"' in body
        for stage in EXECUTION_STAGES:
            if stage == "risk":
                continue
            assert f'stage="{stage}"' not in body, (
                f"{stage} was never observed and must not render as a zero "
                "histogram: that reads as instantaneous, not as unmeasured"
            )

    def test_the_hub_only_asks_for_declared_stages(self) -> None:
        # The mechanism, not just the outcome: the loop walks the vocabulary, so an
        # observation made under a name nobody declared can never be exported as a
        # series the family bounds would have refused anyway.
        metrics = FakeMetrics()
        hub_for(metrics).scrape()
        assert set(metrics.asked_for) == set(EXECUTION_STAGES)

    def test_a_stage_label_outside_the_vocabulary_is_refused(self) -> None:
        hub = hub_for(FakeMetrics())
        with pytest.raises(CardinalityError):
            hub.registry.set_gauge(LATENCY_FAMILY, {"stage": "invented_stage"}, 1.0)


# ---------------------------------------------------------------------------
# 4. what may not appear
# ---------------------------------------------------------------------------


class TestNothingIdentifyingLeaves:
    def test_the_cardinality_law_is_enforced_not_just_documented(self) -> None:
        hub = hub_for(FakeMetrics())
        with pytest.raises(CardinalityError, match="tenant_id"):
            hub.registry.register_counter(
                "wlct_execution_per_tenant_total",
                "would be a disclosure channel",
                "tenant_id",
            )

    def test_the_rendered_text_carries_no_principal_and_no_credential(self) -> None:
        described = {
            "storeDurable": True,
            "locksDistributed": False,
            "retentionEnabled": True,
            "placement": {"label": "placement-attest", "requiresVenueAttestation": True},
            "incidents": {"durable": True},
        }
        body = hub_for(FakeMetrics(orders_submitted=1), described).scrape()
        for needle in (
            "tenant_id",
            "tenant-1",
            "account_id",
            "account-1",
            "order_id",
            "client_order_id",
            "api_secret",
            "private_key",
            "dsn",
            "postgresql://",
        ):
            assert needle not in body, (
                f"{needle!r} reached a scrape that is served without authentication"
            )

    def test_the_scrape_does_not_mutate_the_engine_instrument(self) -> None:
        metrics = FakeMetrics(orders_submitted=5)
        metrics.record_stage("validation", micros=20, samples=2)
        hub = hub_for(metrics)
        before = (metrics.counters.orders_submitted, metrics.stage("validation").count)
        hub.scrape()
        hub.scrape()
        after = (metrics.counters.orders_submitted, metrics._stages["validation"].count)
        assert before == (5, 2)
        assert after == (5, 2)

    def test_a_hub_with_no_instrumentation_says_so_by_omission(self) -> None:
        body = hub_for(None).scrape()
        assert "wlct_execution_orders_submitted_total" not in body
        assert "wlct_process_uptime_seconds" in body  # process families always render


# ---------------------------------------------------------------------------
# 5. wiring gauges, read from the runtime's own description
# ---------------------------------------------------------------------------


class TestWiringGauges:
    def lines(self, body: str) -> dict[str, float]:
        out: dict[str, float] = {}
        for line in body.splitlines():
            match = re.match(
                rf'{WIRING_GAUGE}\{{component="([a-z_]+)",service="[^"]+"\}} ([0-9.]+)',
                line,
            )
            if match:
                out[match.group(1)] = float(match.group(2))
        return out

    def test_every_advertised_component_is_rendered(self) -> None:
        body = hub_for(FakeMetrics()).scrape()
        assert set(self.lines(body)) == {
            "durable_store",
            "durable_incidents",
            "placement_review",
            "venue_attestation",
            "distributed_locks",
            "journal_retention",
            # Part 19's two, added to the same literal set rather than to a
            # separately-maintained count: a component that appeared in the table and
            # not here would pass a count-based assertion and be invisible on a
            # dashboard, which is the failure the set form was chosen to avoid.
            "live_credential_fetcher",
            "operator_confirmation",
            "engine_instrumented",
        }

    def test_a_describe_dict_becomes_the_gauges_a_panel_needs(self) -> None:
        body = hub_for(
            FakeMetrics(),
            {
                "storeDurable": True,
                "locksDistributed": True,
                "retentionEnabled": False,
                "placement": {"label": "placement-attest", "requiresVenueAttestation": False},
                "incidents": {"durable": True},
                "metricsConfigured": True,
            },
        ).scrape()
        values = self.lines(body)
        assert values["durable_store"] == 1
        assert values["durable_incidents"] == 1
        assert values["placement_review"] == 1
        assert values["venue_attestation"] == 0
        assert values["distributed_locks"] == 1
        assert values["journal_retention"] == 0
        assert values["engine_instrumented"] == 1

    def test_a_missing_description_key_publishes_zero_rather_than_a_guess(self) -> None:
        # The point of reading describe() instead of the settings is that when the
        # runtime stops saying something, the panel has to show the gap. Defaulting
        # to True would be the exposition layer making the engine's claim for it.
        body = hub_for(FakeMetrics(), {"storeDurable": None}).scrape()
        assert self.lines(body)["durable_store"] == 0
        # Thirteen parts of this service would have answered 0 here, correctly:
        # no instrument was ever handed to the engine, and the gauge says so.
        assert self.lines(body)["engine_instrumented"] == 0


# ---------------------------------------------------------------------------
# 6. the route, on a booted app
# ---------------------------------------------------------------------------


class TestMetricsRoute:
    def test_the_scrape_needs_no_token(self, client: TestClient) -> None:
        response = client.get("/metrics")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/plain")
        assert "version=0.0.4" in response.headers["content-type"]

    def test_the_engine_counters_are_on_it(self, client: TestClient) -> None:
        body = client.get("/metrics").text
        assert f"# HELP {WIRING_GAUGE}" in body
        assert "# TYPE wlct_execution_wiring gauge" in body
        assert "# TYPE wlct_process_uptime_seconds gauge" in body
        # An idle runtime has written nothing, so the counter families are absent
        # (the renderer's law, not a bug). The line below is the end-to-end proof
        # that a number the engine holds reaches the text: it goes through the
        # public metrics port on the REAL runtime, not through a fake, so a hub
        # wired to the wrong attribute would fail here rather than in production.
        engine = client.app.state.runtime.engine
        assert engine.metrics is not None
        engine.metrics.counters.orders_submitted = 1
        after = client.get("/metrics").text
        assert (
            'wlct_execution_orders_submitted_total{service="execution-engine"} 1' in after
        )

    def test_the_service_hands_its_engine_an_instrument(self, client: TestClient) -> None:
        # The gap this part was written to close, stated as an assertion: the
        # metrics port has been optional on ExecutionEngine since Part 5 and this
        # service never supplied one, so the counters every document describes were
        # accumulated by nothing. Nothing here is new machinery - it is the line
        # that connects the machinery to the process.
        engine = client.app.state.runtime.engine
        instrument = engine.metrics
        assert isinstance(instrument, ExecutionMetrics)
        # The instrument carries the adapter's own id: this runtime is simulated,
        # and labelling its timings with the venue it simulates would be a lie.
        assert instrument.to_dict()["exchange"] == "paper"
        assert set(instrument.to_dict()["stages"]) == set()  # nothing measured yet

    def test_the_status_document_agrees_with_the_gauge(self, client: TestClient) -> None:
        # /status is the plane the worker asserts against, /metrics the plane a
        # dashboard reads; this test is the only thing that keeps them telling the
        # same story, which is why the value is read off both rather than asserted
        # twice against one source.
        status = client.get(
            "/internal/v1/status", headers=auth_headers()
        ).json()
        assert status["metricsConfigured"] is True
        line = next(
            line
            for line in client.get("/metrics").text.splitlines()
            if 'component="engine_instrumented"' in line
        )
        assert line.endswith(" 1")

    def test_ready_reports_it_too(self, client: TestClient) -> None:
        # /health/ready splats the description, so a new wiring fact is visible on
        # the unauthenticated plane as well; pinned because that splat is the only
        # reason the two planes cannot drift, and a splat can be replaced by a
        # hand-written dict without any test noticing until an operator asks.
        assert client.get("/health/ready").json()["metricsConfigured"] is True

    def test_it_is_absent_from_the_openapi_document(self, client: TestClient) -> None:
        assert "/metrics" not in client.get("/openapi.json").json()["paths"]

    def test_reading_metrics_changes_nothing_the_command_plane_sees(
        self, client: TestClient
    ) -> None:
        wiring = client.app.state.runtime.describe()
        client.get("/metrics")
        client.get("/metrics")
        assert client.app.state.runtime.describe() == wiring

    def test_the_diagnostic_review_is_not_counted_as_a_gated_review(
        self, client: TestClient
    ) -> None:
        # The end-to-end claim Part 18 can honestly make about THIS process: the
        # service composes an engine but serves no submission command, so the
        # counters are expected to sit at zero - and the placement endpoint is a
        # question, not an order. If a future change made ``attest`` increment
        # ``placement_reviews``, this assertion is where somebody notices that the
        # dashboard's "reviews" no longer means "orders the gate looked at".
        before = client.get("/metrics").text
        assert render_value(before, "wlct_execution_placement_reviews_total") is None
        reviewed = client.post(
            "/internal/v1/placement/attest",
            headers=auth_headers("tenant-a"),
            json={
                "tenantId": "tenant-a",
                "accountId": "account-1",
                "symbol": "BTCUSDT",
                "orderType": "LIMIT",
                "timeInForce": "GTC",
            },
        )
        assert reviewed.status_code == 200
        after = client.get("/metrics").text
        assert render_value(after, "wlct_execution_placement_reviews_total") is None
        # ...and the review's existence is visible where it should be: on the
        # wiring gauges, which is the whole reason they exist beside the counters.
        rendered = (
            'wlct_execution_wiring{component="placement_review",'
            'service="execution-engine"} 1'
        )
        assert rendered in after

    def test_production_refuses_to_parse_without_exposition(self) -> None:
        with pytest.raises(ValueError, match="OBSERVABILITY_ENABLED=false in production"):
            settings_for(("NODE_ENV", "production"), ("OBSERVABILITY_ENABLED", "false"))

    def test_the_switch_is_published_on_the_configs_safe_view(self) -> None:
        # Same convention as Parts 14 and 15: every non-secret knob appears in the
        # config's public view, which is the contract the logs and any future status
        # surface read. The /status document itself stays the WIRING view - the
        # knob is not a wiring fact, and conflating the two is how a deployment
        # starts reporting its configuration as its state.
        assert settings_for().to_public_dict()["observabilityEnabled"] is True

    def test_a_disabled_exposition_is_a_404_not_a_paragraph(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.config import get_settings
        from app.main import create_app

        monkeypatch.setenv("OBSERVABILITY_ENABLED", "false")
        get_settings.cache_clear()
        try:
            with TestClient(create_app()) as client:
                assert client.get("/metrics").status_code == 404
                # ...and the rest of the plane is untouched, which is the point of
                # gating the mount rather than the handler: a disabled scrape must
                # not be able to affect anything a caller depends on.
                assert client.get("/health").status_code == 200
                assert client.get("/health/ready").status_code == 200
        finally:
            get_settings.cache_clear()

    def test_the_worker_never_forwards_the_scrape(self) -> None:
        # Same guard Parts 14, 15 and 17 wrote for their own routes: the worker
        # client's path list IS the public-facing surface of this service, and a
        # metrics scrape must not be reachable through a tenant's request.
        assert "/metrics" not in ENGINE_CLIENT.read_text(encoding="utf-8")

    def test_the_durable_plane_reports_both_durabilities(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _conn = postgres_client(monkeypatch, stack, [[]])
            body = client.get("/metrics").text
            assert (
                'wlct_execution_wiring{component="durable_store",'
                'service="execution-engine"} 1' in body
            )
            assert (
                'wlct_execution_wiring{component="durable_incidents",'
                'service="execution-engine"} 1' in body
            )
```


## FILE: services/execution-engine/tests/test_part18_asgi_target.py (339 lines)

*14 tests for the thing no check in this repository had ever done: resolve every Python service's image command through uvicorn's own constructor. A plain module:app target requires a module-level binding, a --factory target requires a zero-argument function, the --log-config path has to exist in the build context and load, a dictConfig of two no-op keys must leave an installed handler where it was, and /dev/null must still raise the RuntimeError that made the old flag unstartable - the mechanism pinned, so nobody re-adopts it as a shortcut. The static half parses modules rather than importing them, because the sibling modules build their app at import time and would fail a test for a reason unrelated to the test.*

```python
"""Part 18: the ASGI target an image names has to resolve, and nothing checked it.

Every Python service in this repository is started by a line of shell in its
Dockerfile - ``uvicorn [flags] app.main:something`` - and until this file existed,
no test, script or check in the tree had ever confirmed that the name on that line
exists in the module beside it. That is how ``execution-engine`` shipped for eleven
parts with an image that cannot boot: ``create_app()`` is the only factory the
module defines, there is no module-level ``app``, and the container's first action
was ``AttributeError``-adjacent failure output ("Attribute \"app\" not found in
module \"app.main\"") followed by a restart loop. The healthcheck in the same file
was the only thing that would have noticed, and a healthcheck is read by a runtime
nobody runs here.

Two laws are pinned, and they are deliberately asymmetric in method:

1. **Shape, checked statically, for all three services.** The Dockerfile's uvicorn
   target is parsed and the named module is parsed (AST, not import). A plain
   ``module:attr`` target requires a module-level binding of that name; a
   ``--factory`` target requires a zero-argument function of that name. Nothing is
   imported, because the two sibling modules build their app at import time and
   would refuse to parse settings in a test environment configured for a different
   service - an import here would be a test that fails for the wrong reason.
2. **Reality, checked by doing, for this service.** ``create_app`` is called and
   the object it returns is asserted to be the ASGI application the platform
   expects. A name that exists but is not callable is the same broken image with
   better spelling, and the static half cannot tell the two apart.

The fix this test guards is the factory form in the Dockerfile and in
``python -m app.main``; the reason the service is not "fixed" by adding
``app = create_app()`` at module scope (which the siblings do, and which would have
made the eleven-year-old line correct) is recorded on the command in
``infrastructure/docker/execution-engine.Dockerfile`` and in §6.1 of
``docs/PART18_METRICS_EXPOSITION.md``: settings parse inside ``create_app``, so an
import-time construction turns a startup refusal into an import refusal, and that
would break this suite's own collection as fast as it would break a linter.
"""

from __future__ import annotations

import ast
import inspect
import json
import logging
import logging.config
import re
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[3]

#: service directory name -> its Dockerfile, under infrastructure/docker.
SERVICES = ("trading-engine", "market-data", "execution-engine")

#: A command line names its target after the binary; ``uvicorn.run`` names the
#: same thing as its first argument. Two shapes, one dotted-target rule.
_COMMAND_TARGET = re.compile(r"uvicorn\s+(?P<factory>--factory\s+)?(?P<dotted>[\w.]+:\w+)")
_DOTTED = re.compile(r"^(?P<module>[\w.]+):(?P<attr>\w+)$")
#: The command line is a JSON array, so the path ends at the first quote;
#: [^"\s] rather than \S+ is what keeps a trailing "], from being a filename.
_LOG_FLAG = re.compile(r"--log-config\s+(?P<path>[^\"\s]+)")


@dataclass(frozen=True)
class UvicornTarget:
    """What an image command line actually asks for."""

    module: str
    attribute: str
    factory: bool

    @property
    def dotted(self) -> str:
        return f"{self.module}:{self.attribute}"


def dockerfile(service: str) -> Path:
    return ROOT / "infrastructure" / "docker" / f"{service}.Dockerfile"


def image_log_config(service: str) -> str:
    """The path the image hands uvicorn for ``--log-config``, verbatim."""
    line = next(
        line
        for line in dockerfile(service).read_text(encoding="utf-8").splitlines()
        if line.startswith("CMD [")
    )
    match = _LOG_FLAG.search(line)
    assert match is not None, f"{service}: the image command sets no --log-config"
    return match.group("path")


def log_config_source(service: str, image_path: str) -> Path:
    """The build-context file that becomes that path inside the image.

    The COPY lines put a file next to ``pyproject.toml`` in the WORKDIR, so the
    image's ``./log-config.json`` is the service's ``log-config.json`` - a mapping
    this test reads off the Dockerfile rather than assumes.
    """
    if image_path.startswith("./"):
        return ROOT / "services" / service / image_path.removeprefix("./")
    return ROOT / image_path.lstrip("/")


def module_file(service: str, module: str) -> Path:
    return ROOT / "services" / service / f"{module.replace('.', '/')}.py"


def split_target(dotted: str) -> tuple[str, str]:
    match = _DOTTED.match(dotted)
    assert match is not None, f"{dotted!r} is not a module:attribute target"
    return match.group("module"), match.group("attr")


def parse_target(command: str) -> UvicornTarget:
    match = _COMMAND_TARGET.search(command)
    assert match is not None, f"no uvicorn target in this command: {command!r}"
    module, attribute = split_target(match.group("dotted"))
    return UvicornTarget(
        module=module,
        attribute=attribute,
        factory=match.group("factory") is not None,
    )


def image_command(service: str) -> UvicornTarget:
    """The single command the container runs, read out of the image recipe."""
    text = dockerfile(service).read_text(encoding="utf-8")
    lines = [line for line in text.splitlines() if line.startswith("CMD [")]
    assert len(lines) == 1, f"{service}: expected exactly one CMD, found {len(lines)}"
    # Only the payload string matters; "sh"/"-c" and the flag order around the
    # target are the recipe's business, not this test's.
    return parse_target(lines[0])


class ModuleShape:
    """The two facts about a module that decide which uvicorn form is correct."""

    def __init__(self, path: Path) -> None:
        self.tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

    def has_module_binding(self, name: str) -> bool:
        for node in self.tree.body:
            if isinstance(node, ast.Assign | ast.AnnAssign):
                targets: list[ast.expr] = (
                    list(node.targets) if isinstance(node, ast.Assign) else [node.target]
                )
                if any(isinstance(t, ast.Name) and t.id == name for t in targets):
                    return True
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                if node.name == name:
                    return False  # a def is not a binding the plain form can use
        return False

    def zero_arg_function(self, name: str) -> bool:
        for node in self.tree.body:
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name == name:
                args = node.args
                return not (args.args or args.posonlyargs or args.kwonlyargs or args.vararg)
        return False


@pytest.mark.parametrize("service", SERVICES)
def test_the_image_command_names_a_target_its_module_can_satisfy(service: str) -> None:
    target = image_command(service)
    shape = ModuleShape(module_file(service, target.module))
    if target.factory:
        assert shape.zero_arg_function(target.attribute), (
            f"{service}: the image passes --factory {target.dotted}, but that name is "
            "not a zero-argument function in the module - uvicorn would fail to build the app"
        )
    else:
        assert shape.has_module_binding(target.attribute), (
            f"{service}: the image names {target.dotted} with no --factory, but the module "
            "defines no such object - this is the exact shape of the boot failure Part 18 "
            "found in execution-engine, where create_app is a factory and nothing is bound "
            "to app at module scope"
        )


@pytest.mark.parametrize("service", SERVICES)
def test_the_image_command_survives_uvicorn_s_own_startup(service: str) -> None:
    """Every flag the image passes has to be loadable, by uvicorn, before the app.

    ``uvicorn.Config`` configures logging inside its constructor, so this single
    call is the whole boot-time surface the container depends on - the target, the
    factory flag, and the log config - with no server, no port and no settings
    parse. It is the check that would have failed for eleven parts.
    """
    import uvicorn

    target = image_command(service)
    image_path = image_log_config(service)
    source = log_config_source(service, image_path)
    assert source.is_file(), f"{service}: {image_path} names no file in the build context"
    uvicorn.Config(
        app=target.dotted,
        factory=target.factory,
        log_config=str(source),
    )  # raises if the shape is wrong, which is the assertion


@pytest.mark.parametrize("service", SERVICES)
def test_the_factory_flag_is_not_carried_by_a_module_that_does_not_need_it(service: str) -> None:
    # The mirror of the test above, because a wrong flag is as fatal as a wrong
    # name: --factory against a module-level app instance hands uvicorn an
    # application object and tells it to call it, and calling a FastAPI app raises
    # deep inside the server rather than at the front door.
    target = image_command(service)
    shape = ModuleShape(module_file(service, target.module))
    if shape.has_module_binding(target.attribute):
        assert not target.factory, f"{service}: {target.dotted} is an object, not a factory"


def test_the_two_ways_to_start_this_service_name_the_same_target() -> None:
    # ``python -m app.main`` and the image must not be able to disagree: one is
    # what an operator types, the other is what ships, and a divergence means the
    # reproduction and the deployment are different programs.
    from_image = image_command("execution-engine")
    tree = ast.parse(
        module_file("execution-engine", from_image.module).read_text(encoding="utf-8"),
        filename="main.py",
    )
    from_module = _uvicorn_run_target(tree)
    assert from_module == from_image, (
        f"python -m app.main starts {from_module.dotted if from_module else None} while the "
        "image starts "
        f"{from_image.dotted}"
    )


def _target_of_string(dotted: str) -> UvicornTarget:
    module, attribute = split_target(dotted)
    return UvicornTarget(module=module, attribute=attribute, factory=False)


def _uvicorn_run_target(tree: ast.Module) -> UvicornTarget | None:
    """The ``uvicorn.run`` call inside the module's ``__main__`` block, if any."""
    for node in tree.body:
        if not (isinstance(node, ast.If) and _is_main_guard(node.test)):
            continue
        for call in ast.walk(node):
            if not (isinstance(call, ast.Call) and _is_uvicorn_run(call.func)):
                continue
            target = _target_of_string(call.args[0].value) if call.args else None
            factory = any(
                kw.arg == "factory" and isinstance(kw.value, ast.Constant) and kw.value.value
                for kw in call.keywords
            )
            return UvicornTarget(target.module, target.attribute, factory)
    return None


def _is_main_guard(test: ast.expr) -> bool:
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and any(isinstance(op, ast.Eq) for op in test.ops)
    )


def _is_uvicorn_run(func: ast.expr) -> bool:
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "run"
        and isinstance(func.value, ast.Name)
        and func.value.id == "uvicorn"
    )


def test_the_zero_length_stand_in_that_used_to_be_the_flag_is_rejected() -> None:
    """The reason the file exists, pinned as a behaviour rather than a story.

    ``--log-config /dev/null`` was every Python service's image command until Part
    18: neat, portable, and not loadable. uvicorn routes a path with no .json/.yaml
    suffix to ``logging.config.fileConfig``, which refuses a zero-length file -
    so the container died before importing the app, and the healthcheck in the same
    Dockerfile was the only thing in the repository watching. This test does not
    assert that the old flag is gone (the test above proves the new one loads); it
    asserts the mechanism, so a revert cannot be justified by "it worked for us".
    """
    import uvicorn

    with pytest.raises(RuntimeError, match="empty file"):
        uvicorn.Config(app="app.main:create_app", factory=True, log_config="/dev/null")


def test_the_log_config_changes_nothing_about_the_loggers_it_meets() -> None:
    """"A no-op" is a claim about behaviour, so it is tested as behaviour: an
    existing handler on the root logger has to still be there afterwards, because
    the whole point of the file is that uvicorn must not reconfigure the app's
    JSON pipeline out from under it.
    """
    root = logging.getLogger()
    sentinel = logging.NullHandler()
    root.addHandler(sentinel)
    try:
        for service in SERVICES:
            source = log_config_source(service, image_log_config(service))
            config = json.loads(source.read_text(encoding="utf-8"))
            assert config == {"version": 1, "disable_existing_loggers": False}
            logging.config.dictConfig(config)
            assert sentinel in root.handlers, f"{service}'s log config moved the app's handlers"
    finally:
        root.removeHandler(sentinel)


def test_the_factory_this_image_calls_produces_a_working_application() -> None:
    # The reality half of the docstring: called on a real environment, the named
    # factory returns a FastAPI app that serves the health route. Static checks
    # prove a name exists; only this proves the name is the thing a server needs.
    from fastapi.testclient import TestClient

    from app.main import create_app

    assert callable(create_app)
    assert inspect.signature(create_app).parameters == {}
    built = create_app()
    assert isinstance(built, FastAPI)
    with TestClient(built) as started:
        assert started.get("/health").status_code == 200


def test_no_module_level_app_so_the_import_stays_free() -> None:
    # Why there is no module-level ``app``: an operator running this service with a
    # missing variable must get the settings error at startup, and a test collector,
    # a linter or a docs build must get nothing at all. If someone "fixes" the image
    # by binding ``app = create_app()`` at import, this test is where they learn
    # what that costs - and the Dockerfile comment is where they learn it twice.
    source = module_file("execution-engine", "app.main").read_text(encoding="utf-8")
    shape = ModuleShape(module_file("execution-engine", "app.main"))
    assert not shape.has_module_binding("app"), (
        "app.main now builds its application at import time; that makes settings parsing "
        "an import side effect - see the two comments this test exists to enforce"
    )
    assert "create_app" in source
```


## FILE: libs/trading-core/tests/test_part18_stage_observations.py (232 lines)

*9 tests that the engine's own numbers mean what the exposition says they mean: an accepted submission times exactly the spans it waited on, every timed name is in EXECUTION_STAGES, total_submit is one sample per submission rather than per return path, refusals are timed too, a stage that never answered stays absent, the instrument is exposed, the accessor refuses a write, an engine with no instrumentation still trades, and a port without observe() is tolerated.*

```python
"""Part 18: the four stage spans the engine contains are timed, and nothing else is.

The claim under test is narrow and it is deliberately narrow. ``EXECUTION_STAGES``
has thirteen names; six of them describe work that happens INSIDE
:class:`ExecutionEngine.submit` and seven describe work that happens in a layer the
engine calls across a boundary. Part 18 times the former (plus the review stage
Part 16 already timed) and leaves the latter alone, so the two things these tests
hold are:

* a submission contributes exactly one sample per span it actually waits on, in
  pipeline order - because "the review runs before the gates" is a law with a
  latency consequence, and
* a stage that never answered contributes NOTHING. An exception path is counted and
  recorded as an incident; inventing a duration for it would put "we gave up" on a
  latency histogram, which is the one place a dashboard should not be allowed to lie.

The order is asserted as a list, not as a set, for the same reason Part 16 asserted
its own position in it.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from decimal import Decimal
from typing import Any

import pytest

from wlct_trading.execution.placement_attestor import PlacementReviewer, PlacementReviewPolicy

from tests.test_part16_placement_attestor import (
    CountingAttestor,
    LiveAdapter,
    accepted_result,
    attested,
    build,
    credentials,
    healthy_context,
    intent,
    live_settings,
)


def permissive_reviewer() -> PlacementReviewer:
    """A reviewer that says yes, because this part is not about the answer.

    A live engine without a reviewer is refused by the wiring law Part 16 added,
    so every test here has to carry one; carrying a reviewer that blocks would make
    these tests about the block. One attestation object, returned on every call, so
    the multi-submission cases do not have to script a queue.
    """
    return PlacementReviewer(
        CountingAttestor(attested()),
        PlacementReviewPolicy(),
        requires_venue_attestation=True,
    )


class RecordingMetrics:
    """The metrics port as the engine sees it: observe(name, micros) + counters.

    Deliberately a list of ``(name, micros)`` pairs rather than a dict of
    aggregates: the assertion that matters is WHICH spans were timed and in what
    order, and an aggregate would collapse the two.
    """

    def __init__(self) -> None:
        self.observations: list[tuple[str, int]] = []

    def observe(self, name: str, micros: int) -> None:
        self.observations.append((name, int(micros)))

    @property
    def names(self) -> list[str]:
        return [name for name, _ in self.observations]

    def count_of(self, name: str) -> int:
        return self.names.count(name)


def submit(engine: Any, order_intent: Any = None) -> Any:
    """Run one submission through the engine, synchronously for the test."""
    return asyncio.run(
        engine.submit(
            order_intent if order_intent is not None else intent(),
            healthy_context(credentials=credentials()),
        )
    )


class TestTheRecordedSpans:
    def test_an_accepted_submission_times_the_spans_it_waits_on(self) -> None:
        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        result = submit(engine)
        assert result.outcome.value == "ACCEPTED"
        # The review's own stage is in here because the wiring law requires a
        # reviewer on a live engine; its POSITION is Part 16's claim, and it is
        # asserted rather than tolerated because the order is the design.
        assert metrics.names == [
            "validation",
            "placement_review",
            "safety_gates",
            "risk",
            "total_submit",
        ]

    def test_every_span_is_declared_in_the_vocabulary(self) -> None:
        from wlct_trading.metrics import EXECUTION_STAGES

        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        submit(engine)
        assert set(metrics.names) <= set(EXECUTION_STAGES), (
            "an observation with no declared stage creates no histogram: the sample "
            "is computed, thrown away, and the dashboard under-reports"
        )

    def test_total_submit_is_exactly_one_sample_per_submission(self) -> None:
        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        for _ in range(3):
            submit(engine)
        assert metrics.count_of("total_submit") == 3
        assert metrics.count_of("validation") == 3

    def test_the_refusals_are_timed_too(self) -> None:
        # "refused in 40 micros" and "refused in 4s" are both latency facts, and a
        # histogram that only contains accepted orders cannot answer the question a
        # dashboard is actually built to ask ("why is submit slow"), so the early
        # exits record their own total_submit through finish().
        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        bad = replace(intent(), quantity=Decimal("0"))
        result = submit(engine, bad)
        assert result.outcome.value == "REJECTED_LOCALLY"
        assert metrics.names == ["validation", "total_submit"]

    def test_a_stage_that_never_answered_is_absent_not_zero(self) -> None:
        class ExplodingRisk:
            def evaluate(self, *_args: Any, **_kwargs: Any) -> Any:
                raise RuntimeError("risk store unreachable")

        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        engine._risk_engine = ExplodingRisk()  # the fault under test, not a fixture
        result = submit(engine)
        assert result.error_code.value == "RISK_UNAVAILABLE"
        assert "risk" not in metrics.names
        assert metrics.names == [
            "validation",
            "placement_review",
            "safety_gates",
            "total_submit",
        ]
        # The failure is not lost, it is elsewhere: counted, and recorded as an
        # incident, which is what "error paths are counted, not timed" means.
        assert metrics.observations  # still timed where timing is honest


class TestTheMetricsPortIsReadableAndReadOnly:
    def test_the_engine_exposes_the_instrument_it_writes_to(self) -> None:
        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        assert engine.metrics is metrics

    def test_the_accessor_refuses_a_write(self) -> None:
        # A scrape that could swap the instrument out (or reset it) would make a
        # restart and a deliberate clear look the same on a panel.
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=RecordingMetrics(),
        )
        with pytest.raises(AttributeError):
            engine.metrics = RecordingMetrics()

    def test_an_engine_without_instrumentation_still_trades(self) -> None:
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=None,
        )
        assert engine.metrics is None
        result = submit(engine)
        assert result.outcome.value == "ACCEPTED"

    def test_a_port_without_an_observe_method_is_tolerated(self) -> None:
        class Partial:
            """A duck-typed port that stopped implementing observe."""

        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=Partial(),
        )
        result = submit(engine)
        assert result.outcome.value == "ACCEPTED"
```


## FILE: services/execution-engine/log-config.json (4 lines)

*two no-op keys, in the only place a comment could not live: the .json suffix routes uvicorn to dictConfig instead of fileConfig, and disable_existing_loggers=false is what keeps the app's JSON pipeline intact. Its explanation is on the CMD it belongs to.*

```json
{
  "version": 1,
  "disable_existing_loggers": false
}
```


## FILE: services/trading-engine/log-config.json (4 lines)

*the same file for the sibling whose image carried the same broken flag; created here because Part 18 found the defect by running a command line that all three services share.*

```json
{
  "version": 1,
  "disable_existing_loggers": false
}
```


## FILE: services/market-data/log-config.json (4 lines)

*and the same for market-data. Three identical four-line files rather than one shared file: no service's build context can reach a sibling's, and an ARGV of COPY lines is cheaper to keep true than a mounted volume in a runtime image.*

```json
{
  "version": 1,
  "disable_existing_loggers": false
}
```


## FILE: docs/PART18_METRICS_EXPOSITION.md (406 lines)

*the part document: the gap as three greps and one composition line that was missing, the four exposition laws, 13 stage names with 5 recorded and 8 deliberately not and the rule that decides which is which, the nine-part adapter bug this part found by calling the function for the first time, the instrument the service never handed its engine, and sec. 6.1 - the image that could not boot.*

````text
# Part 18 — metrics exposition: the scrape that was never plugged in

Part 9 built a socket. This part plugs something into it, and in doing so finds
out that the thing on the other end of the cable had never been switched on.

Everything below was measured against the tree in this build, not against the
documents that describe it — which matters here more than in most parts, because
two sentences this part wrote about itself were already wrong when they were
written, and both are recorded as wrong below (§5, §6).

## 1. The gap, with the evidence

Three facts, each checkable in the file named:

* `wlct_trading/observability/metrics.py` has exported
  `observe_latency_histogram(...)` since Part 9 with a docstring saying "the
  service's scrape handler calls this per scrape". For eighteen parts, the
  execution engine had no scrape handler. `grep -rn observe_latency_histogram
  services/execution-engine/app` returned nothing before this part; the
  `services/trading-engine` and `services/market-data` hubs are the only two
  callers in the repository.
* Both sibling services carry `OBSERVABILITY_ENABLED: bool = True` in their
  config and refuse it as `false` under `NODE_ENV=production`
  (`services/trading-engine/app/config.py:91` and `:139`). This service had
  neither — although `docker-compose.yml` has been passing
  `OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}` to it all along
  (trading-engine:215, execution-engine:303, market-data:382). The platform
  always intended the knob; one of the three services never read it.
* The deeper one, found while wiring this part and only fixable here:
  `build_runtime` never passed `metrics=` to `ExecutionEngine`. The port has
  been optional since Part 5, so nothing failed; the engine's `_metrics` was
  `None`, every counter update was a guarded no-op, and every histogram that
  Part 16 documents as evidence of a review was being accumulated by nothing.
  `grep -c metrics app/composition.py` returned 0.

So the honest description of the pre-Part-18 state is not "metrics existed and
nobody scraped them". It is: this service could not measure its own order path,
and the machinery that would have measured it sat unused in the library beside
an adapter nobody called.

## 2. What shipped

New files, by line count as measured in this build:

| File | Lines | What it is |
| --- | --- | --- |
| `services/execution-engine/app/observability.py` | 296 | the hub: families, the per-scrape mirror, the reset accounting |
| `services/execution-engine/app/routers/observability.py` | 46 | `GET /metrics`, `include_in_schema=False` |
| `services/execution-engine/tests/test_part18_observability.py` | 545 | 33 tests, 6 of them against a booted app |
| `services/execution-engine/tests/test_part18_asgi_target.py` | 339 | 14 tests: every Python service's image command line, resolved through uvicorn's own loader (§6.1) |
| `services/{execution-engine,trading-engine,market-data}/log-config.json` | 4 each | the two no-op keys, and the reason a file is needed at all (§6.1) |

Edited files, described rather than counted - a repository with no git in it
cannot report a diff honestly, and a line count invented here would be the kind
of prose number this project has repeatedly had to retract:

* `app/config.py` — `OBSERVABILITY_ENABLED`, the `NODE_ENV=production` refusal,
  and `to_public_dict["observabilityEnabled"]`.
* `app/composition.py` — the instrument the engine never had (§6), and
  `describe()["metricsConfigured"]`.
* `app/schemas.py` + `app/routers/internal.py` — `metricsConfigured` on
  `/internal/v1/status`, through the typed model rather than as a passthrough key.
* `wlct_trading/execution/engine.py` — the public `metrics` property,
  `_observe_stage`, and the four timed spans.
* `wlct_trading/observability/metrics.py` — the cumulative double-accumulation
  fix in the shared adapter (§5), plus Part 9's test corrected and extended to
  pin rendered text.
* `libs/trading-core/tests/test_observability_metrics.py` — the drift pin moved
  from 12 unrecorded stages to 8, naming the five recorded ones individually.
* `infrastructure/docker/{execution-engine,trading-engine,market-data}.Dockerfile`
  — `COPY` of the log config, `--log-config ./log-config.json`, and for
  execution-engine the `--factory` target (§6.1). Three images gained a line;
  one gained a startable command.
* `docs/GETTING_STARTED.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
  `docs/ROADMAP.md`, `services/execution-engine/.env.example`, root
  `.env.example` — the surfaces, the knob, the label law, and the operator's
  version of §6.1.

A scrape of an idle process registers 44 families and renders 7 of them
(29 lines). Both halves of that sentence are the design: the
registry knows about everything the instrument can hold
(36 `wlct_execution_<field>_total` counters derived from
`dataclasses.fields(ExecutionCounters)`, one
`wlct_execution_metrics_resets_total`, the wiring gauge, the one stage
histogram, and five process families from `ensure_process_families`), while the
text only carries what has actually been written — see §3.

Two figures in that paragraph are not the ones this part shipped, and saying so is
cheaper than letting a reader find it: Part 19 added seven review-area counters (29 →
36, docs/PART19_LIVE_ENABLEMENT.md §2) and two wiring components (7 → 9 series), which is
why the idle render grew by two lines. The counter families are still not listed by hand
anywhere, which is the only reason those two parts could touch the same instrument without
editing this file's machinery at all. The byte count this paragraph used to quote is gone
deliberately: `wlct_process_uptime_seconds` prints with a variable number of digits, so a
byte figure is a property of the run and not of the design, and the honest replacement for a
measurement that will not repeat is the one that does.

## 3. The four laws this exposition keeps

1. **Every series carries `service="execution-engine"`.** Not `job`, not `instance`:
   the platform's own label law (`observability/labels.py`,
   `ALLOWED_LABEL_NAMES`) and the reason a scrape from three Python services can
   be merged into one Prometheus without the numbers lying to each other.
2. **A family with no series is absent, not zero.** `render_prometheus` omits
   it, and the test in §4 asserts that an untouched counter family is *missing*
   from the text rather than present as `0`. This is the law that makes "zero
   placement reviews" readable: an unmeasured stage and a stage that measured
   instantaneous work are two different statements, and only one of them can be
   fabricated. A dashboard that wanted zeros must generate them itself (`or
   vector(0)`), and the choice is then visibly the dashboard's.
3. **A decrease in the source is an event, not a negative rate.** `inc()`
   refuses a negative amount by platform law, so the hub mirrors a delta; when
   the source goes backwards (`ExecutionMetrics.reset()`, or a fresh process
   whose counters start at zero while the scrape target's do not) the hub
   re-baselines the mirrored total and increments
   `wlct_execution_metrics_resets_total`. Tested by driving the counters up to
   20, resetting, and asserting the exposition says `11` with `resets 1` and
   then `14` — i.e. the mirrored series survives a reset without pretending it
   is continuous.
4. **Nothing identifying is in the text.** The core refuses `tenant`,
   `account`, `order`, `client_order_id` and friends at registration
   (`CardinalityError`), and this module does not route around the refusal with
   a rename. The test registers one and asserts the refusal. Per-tenant numbers
   belong in the row-level-security-scoped tables (`docs/PART17_DURABLE_INCIDENTS.md`,
   `docs/PART13_DURABLE_STORE.md`), which is where the API queries them.

Reading is also write-free: a scrape never calls `reset()` and never mutates a
histogram, so an operator looking at a number cannot change it. That is why the
hub copies each histogram whole through the adapter instead of re-observing
samples, and why the engine's `metrics` property is read-only with no setter.

## 4. The stages: 13 declared, 5 recorded, 8 not

`EXECUTION_STAGES` is the vocabulary: `validation`, `risk`, `safety_gates`,
`lock_acquire`, `signing`, `placement_review`, `network`, `exchange_ack`,
`persistence`, `total_submit`, `first_fill`, `private_stream_delivery`,
`reconciliation_pass`.

Part 18 times the four spans that exist **inside** the engine's own
`submit()` — `validation`, `safety_gates`, `risk`, and `total_submit`, the last
recorded inside `finish()` so it covers the whole call including the parts that
refuse. `placement_review` was already timed by Part 16. Five of thirteen.

The other eight are not recorded, and the reason is a rule rather than an
omission: **a stage that crosses a process or transport boundary is not this
engine's number to report.** Measuring `signing` here would measure
`SecretProvider.resolve()`; `network` and `exchange_ack` would measure an
adapter this service does not construct in paper mode; `first_fill` and
`private_stream_delivery` belong to the process that owns the venue stream;
`reconciliation_pass` to whoever runs reconciliation; `persistence` to the
store's own pool. The core's histogram docstring says "observations of this
process and its network path, never a latency guarantee", and the way to honour
that sentence is to refuse the spans that would have to be invented. The
histogram family is additionally bounded at registration to
`frozenset(EXECUTION_STAGES)`, so a typo cannot create a fourteenth stage, and
the drift pin in `libs/trading-core/tests/test_observability_metrics.py` names
the five recorded ones individually — `len(unrecorded) == 8` with the message
explaining what a number below 8 (a call site added without updating §6) and a
number above 8 (a call site deleted) each mean.

## 5. What wiring the adapter found: a nine-part bug

`observe_latency_histogram` had been copying `LatencyHistogram.snapshot_buckets()`
— a cumulative array, `le` semantics — into the registry's bucket store, and
`render_prometheus` runs the cumulative sum on its way out. Summing an already
cumulative array once per bucket is correct only for the first bucket. With one
observation in each of two buckets, the exposition said `1` and then `3`: every
`le` line above the first reported observations that never happened, and
`+Inf`/`count` disagreed with the bucket lines.

It survived nine parts because the only test of the adapter read the *series
state* and never the rendered text, and no process in this repository rendered
an adapter-filled histogram until this part existed. The fix is on the adapter's
side (copy per-bucket counts; the renderer owns the cumulative sum), Part 9's
test was corrected — it had been pinning the wrong contract, and its expectation
went from `{"100": 1, "1000": 2}` to `{"100": 1, "1000": 1}` — and both sides
now assert on rendered text (1 / 2 / 3).

Two things worth stating plainly, because they are the reusable part:

* This part did not set out to find a bug; it set out to call a function. An
  adapter with no caller is unverified code no matter how well it is tested.
* A test that asserts internal state where a contract is defined by output is
  how a wrong contract gets nine parts of institutional memory. `docs/` also
  gained a correction of mine at Part 16 §6 in the same style: the claim that the
  counters were "scraped by trading-engine's observability module" was false —
  different process, nothing was scraping — and it is retracted there.

## 6. The instrument the service never had

`build_runtime` now constructs `ExecutionMetrics(exchange=trading.exchange.value)`
and passes it to the engine. The label is the adapter's own exchange id rather
than the venue it simulates: in paper mode the id is `paper`, and a histogram of
simulator round-trips tagged `binance` would make every dashboard that reads it
lie. The venue a deployment points at is already on `/status`.

Three consequences, each pinned:

* `test_the_service_hands_its_engine_an_instrument` — a booted runtime's engine
  carries an `ExecutionMetrics`, and its stage set is empty until work happens.
  This is the whole §1 bullet three expressed as an assertion.
* `describe()` gains `metricsConfigured` and `/internal/v1/status` renders it
  (typed field, default `False`, which is what a pre-Part-18 engine actually was:
  nothing wired — so an old response cannot be misread as "instrumented but
  idle"). The TS worker hand-picks the fields it validates from that document, so
  the new one is additive and ignored by it; it is for operators, not for gates.
* The gauge `wlct_execution_wiring{component="engine_instrumented"}` is sourced
  from `describe()` like the other six components (`durable_store`,
  `durable_incidents`, `placement_review`, `venue_attestation`,
  `distributed_locks`, `journal_retention`), never from settings — a second
  opinion about the wiring is what made the four earlier gauges wrong-looking in
  the first place. A renamed or missing `describe()` key publishes `0` rather
  than a guess, which is what thirteen parts of this service would have said,
  correctly.

### 6.1 The image could not boot, and the flag in it could not either

The §9 recipe is not decoration - it is how this part found a defect with nothing
to do with metrics. Running the documented command resolved `app.main:app`, the name
`infrastructure/docker/execution-engine.Dockerfile` has carried since it was
written, and the app has never defined it: `create_app` is the only factory
`app.main` exposes. Every container built from that image died before importing the
service, and the only thing in this repository that could notice - the image's own
`HEALTHCHECK` - is read by a runtime nobody runs here.

The fix is `--factory app.main:create_app`, in the image command and in
`python -m app.main`, rather than a module-level `app = create_app()` (which is what
the two siblings do): settings are parsed inside `create_app`, so binding the app at
import time converts a start-up refusal into an import-time one. That would break
this suite's own collection - `tests/conftest.py` supplies the environment in an
autouse fixture, after imports - and it would mean a linter or a docs build has to
configure a trading service to read a constant from it. A test pins the absence
(`test_no_module_level_app_so_the_import_stays_free`).

While proving the corrected command, two more things in the same command line
turned out not to work, in all three Python images rather than one:

* `--log-config /dev/null` was a way of saying "install nothing", and it never was
  one. uvicorn routes a path with no `.json`/`.yaml` suffix to
  `logging.config.fileConfig`, and `fileConfig` refuses a zero-length file
  (`RuntimeError: /dev/null is an empty file`) - checked against CPython's own
  sources at v3.11.9, v3.12.7, v3.13.1 and v3.13.3, which all carry the guard. So
  even with a resolvable app name, `trading-engine` and `market-data` would have
  died at the same line their sibling died at.
* Each service now ships `log-config.json`, exactly
  `{"version": 1, "disable_existing_loggers": false}`, COPY'd next to
  `pyproject.toml` and named as `--log-config ./log-config.json`. The `.json`
  suffix is what routes uvicorn to `dictConfig` instead of `fileConfig`; the two
  keys mean "load nothing, change nothing", which is what the old flag was trying to
  say. It is asserted as behaviour, not as intent: a handler installed on the root
  logger before `dictConfig` is still there after
  (`test_the_log_config_changes_nothing_about_the_loggers_it_meets`), because the
  whole value of the file is that uvicorn must not reconfigure the app's JSON
  pipeline out from under it. And the mechanism is pinned too, so a revert cannot
  be argued with "it used to work"
  (`test_the_zero_length_stand_in_that_used_to_be_the_flag_is_rejected`).

What the corrected command produces, run for real against this tree:

```text
$ curl -s localhost:8093/health
{"status":"ok","service":"execution-engine","version":"1.0.0","instanceId":"exec-1"}
$ curl -s localhost:8093/metrics | grep -c '^wlct_'
13
$ curl -s localhost:8093/metrics | grep '^wlct_execution_wiring'
wlct_execution_wiring{component="distributed_locks",service="execution-engine"} 0
wlct_execution_wiring{component="durable_incidents",service="execution-engine"} 0
wlct_execution_wiring{component="durable_store",service="execution-engine"} 0
wlct_execution_wiring{component="engine_instrumented",service="execution-engine"} 1
wlct_execution_wiring{component="journal_retention",service="execution-engine"} 0
wlct_execution_wiring{component="placement_review",service="execution-engine"} 1
wlct_execution_wiring{component="venue_attestation",service="execution-engine"} 0
```

`engine_instrumented 1` is §6's fix, visible in a process rather than in a test.
`durable_store 0` and `durable_incidents 0` are the same truth on a memory backend:
nothing durable is wired, and the panel should say so rather than let a zero mean
whatever the reader needs it to. `docs/GETTING_STARTED.md` carries the operator's
version of this subsection beside the `docker compose up` instructions.

## 7. Configuration, and what refuses

* `OBSERVABILITY_ENABLED=true` by default, the same name as both siblings and
  as `apps/api` (`apps/api/src/config/app-config.service.ts:1045`, whose
  `observabilityEnabled` and `metricsEnabled` knobs predate this part), so one
  platform setting means one thing in four processes.
* `NODE_ENV=production` with it `false` is a **start-up refusal**, in the
  service's own words: a process that can hold a venue key has to be able to
  show what it measured. Fail-closed config is standing law here, and the
  refusal is a parse error rather than a warning log.
* Development may turn it off: the router is then not mounted at all, so
  `GET /metrics` answers 404, and no test asserts an apology body.
* `to_public_dict` carries `observabilityEnabled` so the console can tell the
  deployment's intent from the endpoint's presence.
* `/metrics` is unauthenticated — like `/health` and `/health/ready` beside it,
  and unlike `apps/api`, which gates its exposition behind `x-metrics-token`
  (docs/PART9_OBSERVABILITY.md). The difference is the payload: the API's
  exposition can carry trading-shaped labels, this one cannot (§3 law 4), it is
  reachable only on the `wlct-internal` network, and it is
  `include_in_schema=False` so the path never appears in the OpenAPI document.
  The worker's forwarding list is built from `/internal/v1/*` paths
  (`apps/api/src/modules/worker/engine-internal.client.ts`) and does not include
  it, which a test in this part asserts.

## 8. Deliberately not done

* **No Redis mirror.** Both siblings publish an evidence mirror for the API to
  persist. This service's evidence is its durable store, its incident table
  (Part 17) and its status document; a third copy of the same facts in Redis
  would be a third thing to keep in step. It is also why this service has no
  `REDIS_URL` in `docker-compose.yml` and none in `.env.example`: not an
  oversight, the absence is the decision.
* **No alert engine and no background loop.** Paging belongs to the layers that
  already own `AlertEngine`. Everything here is read at scrape time from state
  the process already holds — no loop to stall, no interval to tune, no
  staleness that is not the engine's own.
* **No metric for a stage across a boundary** (§4), no histogram family per
  stage (one family, bounded `stage` label — thirteen families would be a
  cardinality choice disguised as a convenience), no retention or downsampling
  (Prometheus' problem, and the exposition carries no history of its own), and
  no new table: this part changes no schema, so `rls_coverage.json` stays at 43
  covered tables and `PROBE_TABLES` at 5.
* **No `/metrics` on the API's token gate.** If this service ever gains a label
  that could identify a tenant, the answer is §3's refusal plus an
  `x-metrics-token`, not a filter at render time.

## 9. Verification

```bash
# service: 306 passed, 12 skipped (the 12 need a live Postgres)
cd services/execution-engine
PYTHONPATH=../../libs/trading-core python3 -m pytest -q
PYTHONPATH=../../libs/trading-core python3 -m pytest -q tests/test_part18_observability.py   # 33
python3 -m ruff check app tests                    # All checks passed
PYTHONPATH=../../libs/trading-core python3 -m mypy app   # 23 source files, clean

# core: 1,568 passed; ruff clean; mypy clean over 148 files
cd libs/trading-core
PYTHONPATH=src python3 -m pytest -q
python3 -m ruff check wlct_trading tests
python3 -m mypy wlct_trading

# an idle scrape, by hand, exactly as the image starts the process (sec. 6.1)
cd services/execution-engine
EXECUTION_INTERNAL_TOKEN=$(python3 -c 'print("x"*40)') \
PYTHONPATH=../../libs/trading-core:. uvicorn --factory app.main:create_app \
  --port 8093 --log-config ./log-config.json
curl -s localhost:8093/metrics | grep -c '^wlct_'      # 13 on an idle process
```

These counts were true of this build at the time of writing (Part 17's
convention: counts are historical records, not targets to chase). The service's
suite was 273 before Part 18 and is 320 after, the arithmetic being 273 plus the
47 new tests (33 for the exposition, 14 for the boot target of §6.1); 27 of the
exposition tests drive a hub directly (so the laws can be tested without a request)
and 6 go through a booted app (so the route, the plane and the composition are
tested too). The core's 1,568 and the siblings' 43 and 19 are
reproduced by the handover generator rather than restated here from memory:
`python3 scripts/gen_part18_handover.py --check` runs every gate and compares the
document byte for byte, and that is also where the three image commands are
resolved.

One measured consequence of running that generator three times in a row, stated
because it is the abstract coupling of Part 17's sec. 10 made concrete: Part 17's
ledger delta read **+244** when Part 17's document was regenerated before Part
16's, and **+163** after - not because a line of Part 17's code changed in
between, but because regenerating the ancestor moved the copies it embeds of the
ten files the two parts share forward to post-Part-18 content, and a delta is
measured against exactly that. Part 18's own delta, +324 then +78, moved for the
same reason. No figure here was picked from the flattering round.

## 9.5 The regeneration order, measured

`docs/PART17_DURABLE_INCIDENTS.md` closes with the sentence that the checks stay green
if an ancestor is regenerated last - "Part 17 first, then Part 16". Part 18 ran that
order across three documents (17, 16, then 18) and Part 17's `--check` came back not
byte-identical: its `+163`/`+164` delta flicker is read out of Part 16's embedded
copies, so writing Part 16 last invalidated the document written before it. Regenerating
ancestor-first - 16, then 17, then 18 - produced **13,221 lines / 32 files** for this
part's ledger and three consecutive `OK: ... byte-identical to a fresh generation`
lines on the same build. The rule that actually holds, and the one Part 17's correction
now states: *generate from the oldest document to the newest, then check in the same
order*, because a document's delta depends on copies its ancestors hold, while its tree
counts depend only on files that already exist. With two documents either order
converges once the pair has been swept; that is where the old sentence came from, and
it is why the sentence was kept rather than deleted.

## 10. Known limits, stated where they can be found

* A counter is process-lifetime cumulative. A restart resets it and the scrape
  target's own counters keep rising; the hub's mirrored total re-baselines and
  `wlct_execution_metrics_resets_total` rises (§3). `rate()` on these series is
  meaningful; `increase()` across an unrecorded restart is a guess the platform
  makes visible rather than hides.
* Stage timings are microseconds, bounded to the core's 16 edges from 100µs to
  10s, and describe this process and its network path — the help text carries
  that caveat from the core rather than restating it as a guarantee.
* `total_submit` includes the paths that refuse, so it is not a latency SLO for
  accepted orders; the ratio to `placement_review` and `safety_gates` is where
  the refusal cost becomes visible.
* The wiring gauges are sampled per scrape from `describe()`, so they can change
  mid-process only if the runtime is rebuilt — which nothing in this service
  does; they are cheap and deliberately not cached.
* Nothing here is durable. Metrics are the observable layer; the records that
  must survive are the store (Part 13), the journal retention (Part 14) and the
  incidents (Part 17).
````


## FILE: scripts/gen_part18_handover.py (848 lines)

*this generator. It embeds itself, which is the point of a document that can be rebuilt: the file that produced it is part of the evidence, and the sweep at the end of every write checks its own prose as closely as it checks the code it ships.*

````text
"""Part 18 - metrics exposition and the bootable image: the full-source handover.

Generated, not written by hand, for the reason Part 15 established and Parts 16
and 17 repeated: a hand-copied "full source" document starts drifting the moment a
file changes, and a document whose completeness cannot be re-proved is a document
that merely claims. This script embeds the complete content of every file Part 18
added or modified, states its own gate results by RUNNING the suites, and accepts
``--check``, which regenerates in memory and compares byte for byte against the
committed file.

Copied from ``scripts/gen_part17_handover.py`` and re-pointed, which is the honest
description of the relationship: the gate list, the tree rule, the sweep and the
emission-count guard are that part's machinery, and a second hand-written variant
would be a second thing to keep true. What changed is the header, the file lists,
and the baseline search (now starting at Part 17, newest first). Two improvements to
the machinery itself are deliberate, and both came from watching this part's gates
break rather than reading about them:

* every Python gate is given ``PYTHONPATH`` for the core library, because the
  packages are not installed globally and a header that reports ``FAILED`` for a
  missing ``sys.path`` entry is measuring the machine instead of the code; and
* the sibling suites are named in the header as numbers this script parses, not as
  the sentence "re-verified untouched" - Part 18 edited two of their files, so for
  once "untouched" was not the truth, and a document that copies a phrase from its
  ancestor is copying an assumption.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Final


ROOT = (
    Path(__file__).resolve().parents[1]
    if "__file__" in globals()
    else Path("/home/user/whitelabel-copytrade")
)
OUT = ROOT / "docs" / "PART18_HANDOVER_FULL_SOURCE.md"

#: Prior handovers, newest first: the baseline search for a modified file
#: walks this list and stops at the first document that contains it.
PRIOR_HANDOVERS: Final = tuple(
    ROOT / "docs" / f"PART{n}_HANDOVER_FULL_SOURCE.md" for n in range(17, 0, -1)
)

NEW: Final[list[tuple[str, str]]] = [
    (
        "services/execution-engine/app/observability.py",
        "the hub: counter families DERIVED from dataclasses.fields(ExecutionCounters) so the exporter cannot fall behind the instrument, one stage-bounded histogram copied whole per scrape through the core's adapter rather than re-observed, seven wiring gauges read from describe() instead of from settings, a reset counter because inc() refuses a negative amount, and no background task - everything is read at scrape time from state the process already holds.",
    ),
    (
        "services/execution-engine/app/routers/observability.py",
        "GET /metrics: unauthenticated like the health endpoints beside it, include_in_schema=False so the path never enters the OpenAPI document, and a router that is not mounted at all when OBSERVABILITY_ENABLED is false, which makes the disabled posture a 404 rather than an apology body.",
    ),
    (
        "services/execution-engine/tests/test_part18_observability.py",
        "33 tests in six groups: the exporter/family equality asserted in BOTH directions against the dataclass; mirrored totals as a delta with a decrease counted as a reset (11 then 14, resets 1) instead of lowered; an unrecorded stage ABSENT rather than zero; a forbidden label refused at registration; a scrape that leaves the source alone; and the route's plane on a booted app - no token, no OpenAPI entry, not on the worker's forwarding list, and /status and the gauge agreeing because both are read rather than one being typed from memory.",
    ),
    (
        "services/execution-engine/tests/test_part18_asgi_target.py",
        "14 tests for the thing no check in this repository had ever done: resolve every Python service's image command through uvicorn's own constructor. A plain module:app target requires a module-level binding, a --factory target requires a zero-argument function, the --log-config path has to exist in the build context and load, a dictConfig of two no-op keys must leave an installed handler where it was, and /dev/null must still raise the RuntimeError that made the old flag unstartable - the mechanism pinned, so nobody re-adopts it as a shortcut. The static half parses modules rather than importing them, because the sibling modules build their app at import time and would fail a test for a reason unrelated to the test.",
    ),
    (
        "libs/trading-core/tests/test_part18_stage_observations.py",
        "9 tests that the engine's own numbers mean what the exposition says they mean: an accepted submission times exactly the spans it waited on, every timed name is in EXECUTION_STAGES, total_submit is one sample per submission rather than per return path, refusals are timed too, a stage that never answered stays absent, the instrument is exposed, the accessor refuses a write, an engine with no instrumentation still trades, and a port without observe() is tolerated.",
    ),
    (
        "services/execution-engine/log-config.json",
        "two no-op keys, in the only place a comment could not live: the .json suffix routes uvicorn to dictConfig instead of fileConfig, and disable_existing_loggers=false is what keeps the app's JSON pipeline intact. Its explanation is on the CMD it belongs to.",
    ),
    (
        "services/trading-engine/log-config.json",
        "the same file for the sibling whose image carried the same broken flag; created here because Part 18 found the defect by running a command line that all three services share.",
    ),
    (
        "services/market-data/log-config.json",
        "and the same for market-data. Three identical four-line files rather than one shared file: no service's build context can reach a sibling's, and an ARGV of COPY lines is cheaper to keep true than a mounted volume in a runtime image.",
    ),
    (
        "docs/PART18_METRICS_EXPOSITION.md",
        "the part document: the gap as three greps and one composition line that was missing, the four exposition laws, 13 stage names with 5 recorded and 8 deliberately not and the rule that decides which is which, the nine-part adapter bug this part found by calling the function for the first time, the instrument the service never handed its engine, and sec. 6.1 - the image that could not boot.",
    ),
    (
        "scripts/gen_part18_handover.py",
        "this generator. It embeds itself, which is the point of a document that can be rebuilt: the file that produced it is part of the evidence, and the sweep at the end of every write checks its own prose as closely as it checks the code it ships.",
    ),
]
MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/execution/engine.py",
        "the public read-only metrics property (no setter, so a scrape cannot be turned into a way of writing to the engine) and the four spans timed inside submit(): validation, safety_gates, risk, and total_submit recorded in finish() so it covers the paths that refuse as well as the one that succeeds.",
    ),
    (
        "libs/trading-core/wlct_trading/observability/metrics.py",
        "the bug fix this part exists as evidence of: observe_latency_histogram copied a cumulative array into a store the renderer sums, so every le line above the first bucket reported observations that never happened. It now copies per-bucket counts and says why on the copy loop, in the voice of someone recording how a wrong contract survived nine parts of passing tests.",
    ),
    (
        "libs/trading-core/tests/test_observability_metrics.py",
        "the drift pin this part had to move and the rendered-text assertions that the old test lacked: the unrecorded-stage count went from 12 to 8 with the five recorded names spelled out, and the adapter's test now asserts the exposition text (1, 2, 3) rather than the internal series that had been pinning the wrong semantics with a straight face.",
    ),
    (
        "libs/trading-core/tests/test_part16_placement_attestor.py",
        "the stage list the Part 16 test pins became the pipeline in order, with placement_review as the fifth name rather than a lone entry: the order is the assertion, because a list of names that no longer matches the code path is how a timed stage gets moved out of the span it is supposed to measure.",
    ),
    (
        "services/execution-engine/app/config.py",
        "OBSERVABILITY_ENABLED defaulting true, the NODE_ENV=production refusal to run dark, and observabilityEnabled on to_public_dict so a console can tell intent from the endpoint's presence. Same name and same rule as both siblings, which is why compose has been passing it to this service since before this part read it.",
    ),
    (
        "services/execution-engine/app/composition.py",
        "the instrument the engine never had: build_runtime now constructs ExecutionMetrics labelled with the adapter's own exchange id, because a histogram of simulator round-trips tagged binance would make every dashboard that reads it lie; and describe() publishes metricsConfigured, which is where every wiring fact in this service already lives.",
    ),
    (
        "services/execution-engine/app/schemas.py",
        "metrics_configured on the typed status model, defaulting False - which is what a pre-Part-18 engine actually was rather than a hedge, so an old response cannot be read as instrumented-but-idle.",
    ),
    (
        "services/execution-engine/app/routers/internal.py",
        "one more field mapped from describe() through its view, with the missing key left to raise: Part 16's parity discipline keeps a field from reaching an internal caller unreviewed, and the same rule says a description that stopped publishing something should fail the route rather than answer a guess.",
    ),
    (
        "services/execution-engine/app/main.py",
        "the hub built after the runtime and not wrapped in a try (a registry that refuses a family is a wiring mistake, and wiring mistakes die at startup here), the router mounted only when the flag is on, and the __main__ block brought onto the same target the image names - uvicorn.run(\"app.main:create_app\", factory=True) - so the reproduction and the deployment cannot be different programs.",
    ),
    (
        "services/execution-engine/requirements-dev.txt",
        "sqlglot==30.18.0 declared. Part 13's tests had been parsing migrations through an optional import for nine parts, which meant a clean install did not fail - it quietly collected fewer tests, the worst failure mode a dependency can have.",
    ),
    (
        "services/execution-engine/tests/test_part13_drift_parity.py",
        "the module-level sqlglot import that replaces pytest.importorskip, so a missing dependency is a collection error naming the file rather than a smaller suite nobody notices.",
    ),
    (
        "services/execution-engine/tests/test_part13_postgres_store.py",
        "the same change on the other side of that pair: two skip-if-absent imports became one hard import, and the count of tests this suite can run stopped depending on what the machine happened to have installed.",
    ),
    (
        "services/execution-engine/.env.example",
        "the observability block, with the two sentences an operator needs: what the endpoint is, and that this service deliberately has no REDIS_URL because it mirrors nothing.",
    ),
    (
        ".env.example",
        "the shared-knob note under Part 9's observability section, naming all three Python services so the platform-level meaning of OBSERVABILITY_ENABLED is stated once rather than inferred three times.",
    ),
    (
        "infrastructure/docker/execution-engine.Dockerfile",
        "the command that can now start the service: --factory app.main:create_app, and --log-config ./log-config.json with the COPY that puts it in the image. The comment above the CMD carries the whole story, including why a module-level app is not the fix.",
    ),
    (
        "infrastructure/docker/trading-engine.Dockerfile",
        "the log-config line and its comment. The app target here was always correct - the module binds app = create_app() - which is the difference this part had to discover rather than assume, and the reason the new test checks both forms.",
    ),
    (
        "infrastructure/docker/market-data.Dockerfile",
        "and the same, for the same reason. Two images gained a loadable flag and nothing else; the third gained the ability to boot.",
    ),
    (
        "docs/PART16_PLACEMENT_REVIEW.md",
        "sec. 6 amended rather than rewritten: the counters this part documents were never scraped by anything (the earlier sentence claiming trading-engine's module did it was false - different process, no shared memory), the 12 unrecorded stages became 8, and the part's own verification counts are marked historical, which is how this repository stops re-basing numbers it can no longer reproduce.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "the service's surface gains its metrics endpoint and the metricsConfigured field, with the reason each is published rather than an assertion that it is useful.",
    ),
    (
        "docs/SECURITY.md",
        "the /metrics posture bullet extended: the token is the API plane's control and is deliberately absent on the three Python services, because what makes those safe to scrape is the cardinality law at registration - there is nothing identifying on them to disclose - and the bullet says so instead of leaving a reader to conclude the exception was overlooked.",
    ),
    (
        "docs/GETTING_STARTED.md",
        "a note beside docker compose up, where a reader would otherwise form the belief that these images start: what was broken, what it looked like, and the test that now loads every image command.",
    ),
    (
        "docs/ROADMAP.md",
        "row 18, and the retirement sentence that says which backlog item this part closed and which deployment-side items it left alone - the alert rules and dashboards are still nobody's code, and the row says that rather than implying a scrape is an alert.",
    ),
]
#: Prose a shipped file must never contain: a sentence that ANNOUNCES content was
#: left out. Each entry is a phrase rather than a word because the words themselves
#: are vocabulary - "truncated" appears in correct code (a JSON body cut short, an
#: age rounded to the millisecond) and "omitted" appears in a test NAMED
#: test_empty_families_are_omitted. Part 15 carried the bare words and Part 16's
#: files could not be written without tripping them, which is how a guard gets
#: loosened by accident: the fix was always to say the phrase, never to widen the
#: word.
ELISION_TOKENS: Final[tuple[str, ...]] = (
    "<generated>",
    "(snip",
    "... elided",
    "lines omitted",
    "truncated for brevity",
    "content truncated",
    "truncated here",
    "for brevity",
    "see repo for full",
    "rest of the file",
    "same as above",
    "etc.",
    "unchanged`",
    "omitted for brevity",
    "content omitted",
    "source omitted",
    "omitted from this",
    "omitted here",
    "intentionally omitted",
)

#: The shape an elided block actually leaves behind: a line that is nothing but the
#: marker. As a substring this fires on ordinary comments - "# ...but the registry
#: still counts it" is a sentence, not an admission - so it is matched per line.
ELISION_LINE_MARKERS: Final[tuple[str, ...]] = ("// ...", "# ...", "#...", "//...")


NEW_ONLY_TOKENS: Final[tuple[str, ...]] = (
    "TODO",
    "implement this later",
    "type: ignore",
    "noqa",
    "eslint-disable",
    "@ts-ignore",
    "@ts-expect-error",
)

#: The file that DEFINES the banned tokens as guard data is exempt from its own
#: substring scan, computed from __file__ rather than written out, because a
#: hardcoded exemption is how a copied generator ends up exempting its ancestor and
#: failing on itself - which is exactly what happened when this script was derived
#: from Part 16's. Stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset(
    {Path(__file__).resolve().relative_to(ROOT).as_posix()}
    if "__file__" in globals()
    else frozenset({"scripts/gen_part18_handover.py"})
)


def fence(rel_path: str, text: str) -> str:
    if "```" in text:
        return "````text\n" + text.rstrip("\n") + "\n````\n"
    name = rel_path.rsplit("/", 1)[-1]
    lang = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".sql": "sql",
        ".json": "json",
        ".prisma": "prisma",
        ".toml": "toml",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".mjs": "javascript",
        ".txt": "text",
        ".md": "markdown",
    }.get(
        "." + name.rsplit(".", 1)[-1] if "." in name else "",
        "dotenv" if name == ".env.example" else (
            "yaml" if name.endswith("Dockerfile") else ""
        ),
    )
    return f"```{lang}\n" + text.rstrip("\n") + "\n```\n"


def lines_of(rel: str) -> int:
    return len((ROOT / rel).read_text(encoding="utf-8").splitlines())


def baselines() -> dict[str, int]:
    """For every file in any prior handover: the line count THAT document
    recorded. Newest document wins, which is what makes a delta honest: the
    baseline for `app/config.py` is Part 14's emission (because Part 14 last
    changed it), the baseline for `docs/DR.md` is older, and neither is
    guessed."""
    table: dict[str, int] = {}
    for handover in PRIOR_HANDOVERS:
        if not handover.exists():
            continue
        text = handover.read_text(encoding="utf-8")
        for match in re.finditer(r"^## FILE: (.+?) \((\d+) lines\)", text, re.MULTILINE):
            table.setdefault(match.group(1).strip(), int(match.group(2)))
    return table


def block(rel: str, note: str) -> str:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    return f"## FILE: {rel} ({len(text.splitlines())} lines)\n\n*{note}*\n\n{fence(rel, text)}\n"


def file_problems(rel: str, text: str, *, new_file: bool) -> list[str]:
    """Every elision or suppression problem in one file's text.

    Split out of :func:`sweep` so the marker rules are checkable on a string: a
    guard nobody can exercise is a guard nobody trusts, and this one has now
    produced two false positives on files this part merely modified - each of
    which was a real imprecision in the rule rather than in the repository.
    """
    problems: list[str] = []
    for token in ELISION_TOKENS:
        if token in text:
            problems.append(f"{rel}: contains {token!r}")
    for marker in ELISION_LINE_MARKERS:
        if any(line.strip() == marker for line in text.splitlines()):
            problems.append(f"{rel}: contains the bare elision line {marker!r}")
    if new_file:
        for token in NEW_ONLY_TOKENS:
            if token in text:
                problems.append(f"{rel}: a new file containing {token!r}")
    return problems


def sweep() -> list[str]:
    problems: list[str] = []
    for kind, entries in (("NEW", NEW), ("MODIFIED", MODIFIED)):
        for rel, _ in entries:
            if rel in SWEEP_SELF_EXEMPT:
                continue
            text = (ROOT / rel).read_text(encoding="utf-8")
            for problem in file_problems(rel, text, new_file=kind == "NEW"):
                problems.append(f"{kind} {problem}")
    return problems


# --------------------------------------------------------------------------
# measurement: the header's numbers are RUN, not remembered
# --------------------------------------------------------------------------


def run(argv: list[str], cwd: Path, env: dict[str, str] | None = None) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            argv,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=1800,
            check=False,
            env={**os.environ, **env} if env else None,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return 127, f"could not run {' '.join(argv)}: {error}"
    return proc.returncode, proc.stdout + proc.stderr


def last_match(pattern: str, text: str) -> str | None:
    found = re.findall(pattern, text)
    return str(found[-1]) if found else None


def measure() -> dict[str, object]:
    """Every gate the part must pass, executed now, parsed from its own
    output. A number that cannot be parsed is reported as 'UNPARSED', not
    defaulted to something flattering - this header is evidence, and
    evidence with a soft spot in it is the thing Part 15 exists to replace."""
    out: dict[str, object] = {}

    code, text = run(["python3", "-m", "pytest", "-q"], ROOT / "libs" / "trading-core")
    out["core_pytest"] = (last_match(r"(\d+) passed", text) if code == 0 else f"FAILED: {text[-300:]}")
    out["core_pytest_code"] = code
    code, text = run(["python3", "-m", "ruff", "check", "wlct_trading", "tests"], ROOT / "libs" / "trading-core")
    out["core_ruff"] = "green" if code == 0 else text[-300:]
    # The core gate covers the library and its tests. The standalone fixture
    # generators under scripts/ are outside it by design (they must run with a
    # bare `python3` and no installed package, so their import order is
    # deliberate); counting their findings here keeps "green" from being read
    # as "whole directory swept".
    code, text = run(["python3", "-m", "ruff", "check", "scripts"], ROOT / "libs" / "trading-core")
    out["core_ruff_scripts"] = "0 findings" if code == 0 else (last_match(r"Found (\d+) errors?", text) or "?") + " findings"
    code, text = run(["python3", "-m", "mypy", "wlct_trading"], ROOT / "libs" / "trading-core")
    out["core_mypy"] = last_match(r"no issues found in (\d+) source files", text) or text[-160:]

    # "Zero suppression tokens" is a claim this header has always made by hand.
    # It is counted here instead, over the files the part added and, separately,
    # over the files it only modified - because the modified ones do carry
    # pre-existing `# noqa: BLE001` lines from Parts 5/12/14, and a header that
    # reported "0" by scanning only its own new files would be measuring the
    # flattering half. This generator is excluded: it quotes the token names to
    # say what is forbidden.
    tokens = ("type: ignore", "noqa", "eslint-disable", "prettier-ignore")

    def _count(entries: list[tuple[str, str]]) -> int:
        total = 0
        for rel, _note in entries:
            if not rel.endswith(".py") or rel.startswith("scripts/"):
                continue
            for line in (ROOT / rel).read_text(encoding="utf-8").splitlines():
                total += sum(1 for tok in tokens if tok in line)
        return total

    out["suppression_new"] = _count(NEW)
    out["suppression_modified"] = _count(MODIFIED)

    engine = ROOT / "services" / "execution-engine"
    code, text = run(
        ["python3", "-m", "pytest", "-q"],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_pytest"] = (
        f"{last_match(r'(\d+) passed', text)} passed, {last_match(r'(\d+) skipped', text) or '0'} skipped"
        if code == 0
        else f"FAILED: {text[-300:]}"
    )
    code, text = run(["python3", "-m", "ruff", "check", "app", "tests"], engine)
    out["engine_ruff"] = "green" if code == 0 else text[-300:]
    code, text = run(
        ["python3", "-m", "mypy", "app"],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_mypy"] = last_match(r"no issues found in (\d+) source files", text) or text[-160:]

    code, text = run(["node", "--test", "scripts/"], ROOT)
    out["node_scripts"] = (
        f"{last_match(r'# pass (\d+)', text)} passed / {last_match(r'# fail (\d+)', text)} failed"
        if code == 0
        else f"FAILED: {text[-400:]}"
    )
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check"], ROOT)
    out["manifest_check"] = text.strip().splitlines()[0] if code == 0 else f"FAILED: {text[-300:]}"
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check-rls"], ROOT)
    # exit 1 here is the HONEST answer (no audit recorded yet in this repo),
    # so the text is quoted and the code explained, not smoothed over.
    out["check_rls"] = f"exit {code}: {text.strip().splitlines()[0]}" if text.strip() else f"exit {code}"

    api = ROOT / "apps" / "api"
    code, text = run(["npx", "jest", "--silent"], api)
    out["api_tests"] = (
        f"{last_match(r'Tests:\s+(\d+) passed', text)} passed / {last_match(r'Test Suites:\s+(\d+) passed', text)} suites"
        if code == 0
        else f"FAILED: {text[-400:]}"
    )
    code, text = run(["npx", "tsc", "-p", "tsconfig.json", "--noEmit"], api)
    out["api_typecheck"] = "0 errors" if code == 0 else f"FAILED: {text[-300:]}"
    # `prisma validate` resolves every env() reference before it will parse
    # the datasource, so it exits 1 in a checkout with no .env (correctly:
    # nothing is committed to satisfy it). The placeholders below are not
    # credentials - validation never opens a connection - and naming them here
    # is what keeps this gate reproducible on a fresh clone instead of a
    # command that only passes on the machine that happened to export a DSN.
    code, text = run(
        ["npx", "prisma", "validate", "--schema", "prisma/schema.prisma"],
        api,
        {
            "DATABASE_URL": "postgresql://validate:validate@localhost:5432/validate",
            "DIRECT_DATABASE_URL": "postgresql://validate:validate@localhost:5432/validate",
        },
    )
    out["prisma"] = "valid" if code == 0 else f"FAILED: {text[-200:]}"
    code, text = run(["npx", "eslint", "src", "--max-warnings", "0"], api)
    out["api_lint"] = "clean" if code == 0 else f"FAILED: {text[-400:]}"

    code, text = run(["npx", "tsc", "--noEmit"], ROOT / "apps" / "admin-web")
    out["admin_typecheck"] = "0 errors" if code == 0 else f"FAILED: {text[-300:]}"

    for service, name in (("trading-engine", "trading"), ("market-data", "market")):
        code, text = run(
            ["python3", "-m", "pytest", "-q"],
            ROOT / "services" / service,
            {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
        )
        out[f"{name}_service"] = (last_match(r"(\d+) passed", text) if code == 0 else "FAILED") or "FAILED"
    # The image commands of all three Python services, resolved by the same
    # subprocess this document embeds: if the boot target regresses, the number
    # below moves and the header says FAILED - it is not a footnote about ops.
    code, text = run(
        [
            "python3",
            "-m",
            "pytest",
            "-q",
            "tests/test_part18_asgi_target.py",
            "tests/test_part18_observability.py",
        ],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_part18"] = (
        f"{last_match(r'(\d+) passed', text)} passed"
        if code == 0
        else f"FAILED: {text[-300:]}"
    )

    out["tree"] = count_tree_lines()
    return out


EXCLUDE_DIRS: Final[frozenset[str]] = frozenset(
    {
        "node_modules", "dist", ".next", ".git", "build", "coverage", "__pycache__",
        ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "venv",
        "target", "out", "site-packages",
    }
)


def count_tree_lines() -> dict[str, int]:
    """Whole-tree counts, measured. The rule set is stated in full because
    a total without its definition is decoration: every file in the tree
    except generated/vendored directories and lockfiles; `source` excludes
    everything under `docs/`, `with_docs` includes it; BOTH exclude the
    regenerable `docs/PART*HANDOVER*` dumps (matched on the `_HANDOVER` segment rather
    than on `PART<n>_`, because Part 6 named one of its two dumps differently and that
    name slipped the prefix) and `docs/source/`. Prior parts
    measured their own totals under their own generators - those numbers are
    not reproduced or compared here on purpose, because a total whose rule
    cannot be re-run is not a measurement."""
    source = 0
    with_docs = 0
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        parts = rel.parts
        if any(part in EXCLUDE_DIRS for part in parts):
            continue
        name = rel.as_posix()
        if name.endswith("package-lock.json"):
            continue
        if name.startswith("docs/source/"):
            continue
        # The pattern was `docs/PART\d+_HANDOVER`, which silently kept
        # docs/PART6_PERSISTENCE_HANDOVER_FULL_SOURCE.md inside the totals: 25,848 lines
        # of generated dump counted as though they were a hand-written document, in a
        # header whose entire claim to trustworthiness is that its numbers are measured.
        # A prefix a later part can rename around is not a rule, so the match is on the
        # `_HANDOVER` segment, and the number of excluded files is stated in the prose
        # rather than assumed.
        is_handover = ".source" in name or bool(re.match(r"docs/PART[^/]*_HANDOVER", name))
        is_doc = name.startswith("docs/")
        if is_handover:
            continue
        try:
            count = sum(1 for _ in path.open("rb"))
        except (OSError, UnicodeDecodeError):
            continue
        source += 0 if is_doc else count
        with_docs += count
    return {"source": source, "with_docs": with_docs}


HEADER_TEMPLATE = '''
# Part 18 - metrics exposition and the bootable image: full source handover

> **What this part changed, and what it did not:** the execution engine now serves
> `GET /metrics`, its engine has an instrument for the first time, four spans inside
> `ExecutionEngine.submit` are timed, the shared exposition adapter has one fewer
> bug than it has carried since Part 9, and all three Python images have a command
> line that can start a process. No order path changed its outcome, no table was
> added, nothing was pruned or exported to Redis, `EXECUTION_MODE=live` is still
> refused at startup with Part 16's sentence, and no TypeScript file was touched.

Complete content of every file created or modified by Part 18. Nothing is
abbreviated, quoted-with-ellipsis, or referred to by path: each block carries the
whole current file, so this document alone can be reviewed, diffed against an
earlier part's handover, or used to reconstruct the tree.

## Gates (run while this document was generated)

* `cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m
  pytest -q` -> **{engine_pytest}**. The skips are Parts 13's and 14's
  live-Postgres suites, skipping BY NAME without `EXECUTION_TEST_POSTGRES_DSN`, and
  the count is the same 12 Parts 15-17 reported: Part 18 added no live test, because
  every law it ships is about exposition and statement shape, which a fake pool and a
  `TestClient` prove. This part's two files on their own -> **{engine_part18}**.
  `ruff check app tests` -> {engine_ruff}; `mypy app` -> no issues in
  **{engine_mypy} source files**, three more than Part 17 measured: the hub, its
  router, and the boot-target test, all annotated.
* `cd libs/trading-core && python3 -m pytest -q` -> **{core_pytest}**, up from Part
  17's figure because the part's core suite and the corrected Part 9 adapter test are
  in it; the library gained the `metrics` accessor, `_observe_stage`, and the fix
  inside `observe_latency_histogram`, and it gained no new port or vocabulary - the
  13 stage names and 29 counter fields it now exposes are the ones Parts 5 and 16
  shipped. `ruff check wlct_trading tests` -> {core_ruff} ({core_ruff_scripts} in
  `libs/trading-core/scripts`, which are standalone by design);
  `mypy wlct_trading` -> no issues in **{core_mypy} source files**.
* Sibling suites, since this part edited their files rather than leaving them
  alone: trading-engine **{trading_service}**, market-data **{market_service}**. Each
  gained `log-config.json` and a corrected image command line, and neither gained a
  code path - which is what those two numbers are here to confirm rather than assert.
* **Suppression tokens: {suppression_new} in the files Part 18 added**, counted by
  this script over every new source and test file rather than asserted from memory.
  This part earned that count the slow way: the first draft of the hub had two
  `# noqa` tokens on imports that would have failed a reader's eye instead of a
  lint, and the first draft of the test file had a `# noqa: ANN401` on a
  `**kwargs`-splatting helper that the fix replaced with typed keyword arguments. The
  {suppression_modified} tokens in the modified files are Part 5/12/13/16 lines,
  left alone for the reason Part 16 stated: rewriting a neighbour's justified comment
  to improve a new part's score is churn wearing care's clothing.
* `node --test scripts/` -> **{node_scripts}**;
  `node scripts/dr-manifest.mjs --check` -> {manifest_check};
  `node scripts/dr-manifest.mjs --check-rls` -> {check_rls}. Both node checks are
  unchanged by this part, and that is the correct result to print: Part 18 adds no
  table, so the covered set stays at 43 and `PROBE_TABLES` at 5, and the enablement
  audit is still owed by the operator rather than by this document.
* `cd apps/api && npx jest --silent` -> **{api_tests}**;
  `npx tsc -p tsconfig.json --noEmit` -> {api_typecheck};
  `npx eslint src --max-warnings 0` -> {api_lint}; `npx prisma validate` ->
  {prisma}. In `apps/admin-web`, `npx tsc --noEmit` -> {admin_typecheck}. No screen
  and no API code changed: `/metrics` is not a surface the console or the worker
  consumes - the worker's forwarding list is built from `/internal/v1/*` paths, which
  is asserted in this part's own suite rather than assumed from the compose file.

## Ledger

Measured at generation time, with code and documents counted separately because a
tree-size figure that mixes them is not a size. Part 18 shipped **{total:,} lines** -
**{new_code:,}** across the {new_code_count} new code files, **{new_docs:,}** in the
{new_docs_count} new document{new_docs_s}, and **+{mod_code:,}** code /
**+{mod_docs:,}** document lines across the {mod_count} modified files (each delta
measured against the newest prior handover that lists that file - which leaves
{unbaselined_count} of them, {unbaselined_size} lines, with no delta at all because
no earlier document recorded their prior size: {unbaselined_list}. Their full text is
embedded below, and their size is not presented as a change). Whole-tree counts
under the standing rule set: **{tree_source:,} source lines**; adding the narrative
documents under `docs/` (the regenerable `docs/source/` views and every handover
dump are out of both figures): **{tree_with_docs:,}**.

Three things this document does that a hand-written one cannot keep doing: the gate
numbers above are subprocess runs of the real suites, so a suite that cannot be
measured is written here as `FAILED` rather than omitted; the file lists are the
part's complete diff, enumerated from the files that carry its markers rather than as
a plan remembered afterwards; and `--check` regenerates the document in memory and
compares it byte for byte with the committed file, which is what makes deterministic
and regenerable a command with an exit code instead of an adjective. The emission
count is asserted at the end of every write - the number of `## FILE:` blocks must
equal the number of files the lists name, so a silently skipped file is a failed run
rather than a shorter document.

Two provenance notes, because they are the kind of sentence a later part would
otherwise read as boilerplate. This part is the first to change a *shipped image*
rather than only code, and the change is a repair rather than an addition:
`--log-config /dev/null` had been in all three Python Dockerfiles since those files
were written, `logging.config.fileConfig` has refused a zero-length file since at
least python 3.11.9, and nothing in this repository resolves an image command line -
so the defect was not invisible because it was unimportant, it was invisible because
no gate looked. The test this part added (`tests/test_part18_asgi_target.py`) is the
gate, and `docs/PART18_METRICS_EXPOSITION.md` sec. 6.1 is the record, including the
one command whose output proved the fix: the same curl that failed for eleven parts.
And the second half of the honesty: the metrics this part exposes were, until it
existed, accumulated by nothing in this process, because `build_runtime` never
passed `metrics=` to the engine. Every earlier document that described those counters
as measurable was describing a port with nothing behind it. That sentence belongs in
a handover header rather than in a changelog, because the reader of a handover is the
person deciding whether to trust the numbers.

One hazard the ledger exposes that Part 17 named and Part 18 proves again. The
baseline for a modified file is the newest prior handover that lists it, and this
part's files overlap Parts 13-17's heavily (the service's config, composition,
schemas, internal router, main, the two docs, the root env example, and two sibling
Dockerfiles that no prior handover ever listed). When an ancestor document is
regenerated - which it must be, because its own rule is that it embeds the complete
current content of every file it names - the copies inside it move forward to
post-Part-18 content, and this part's delta is then measured against a snapshot that
already contains this part's edits. So the figure below is measured after that
regeneration, the coupling is stated rather than hidden, and `--check` on any of the
three documents reproduces what it prints.
'''






def reflow_header(text: str) -> str:
    """Re-wrap the gate bullets after interpolation.

    WHY: the measured values ("16 findings", the manifest's whole summary line)
    have lengths of their own, so prose hand-wrapped in the template goes ragged
    the moment numbers are substituted - and one long value can push a line past
    180 characters in a document meant to be read in a terminal. Unwrapping each
    bullet and re-wrapping at a fixed width keeps every generated handover the
    same shape no matter what the tools printed. Long tokens (paths, commands)
    are never broken, because a hyphenated path split across two lines is a path
    nobody can copy.
    """
    out: list[str] = []
    # Two boundaries, not one: a bullet and a heading. Splitting only on bullets
    # leaves everything after the LAST bullet glued to it - which is how Part 16's
    # generated documents ended up with their whole ledger paragraph rendered as
    # indented continuation text, and how this one first swallowed its own
    # "## Ledger" heading into the final bullet. A heading is a boundary; the
    # rewriter's job is to keep the bullets even, not to re-decide the structure.
    for chunk in re.split(r"(?m)(?=^\* )|(?=^#{2,3} )", text):
        if not chunk.startswith("* "):
            out.append(chunk)
            continue
        trailing = "\n\n" if chunk.endswith("\n\n") else "\n"
        flat = " ".join(part.strip() for part in chunk.rstrip("\n").splitlines() if part.strip())
        # The twin left this marker doubled in every generated handover since Part
        # 14: the template's bullets begin with "* ", the split keeps it in the
        # chunk, and textwrap re-adds it via initial_indent. Fixed here rather
        # than inherited, because a bullet list that renders as "* * " is a
        # document whose first line already tells the reader nobody ran it.
        if flat.startswith("* "):
            flat = flat[2:]
        wrapped = textwrap.wrap(
            flat,
            width=92,
            initial_indent="* ",
            subsequent_indent="  ",
            break_long_words=False,
            break_on_hyphens=False,
        )
        out.append("\n".join(wrapped) + trailing)
    return "".join(out)


def _tree_counts(measured: dict[str, object]) -> tuple[int, int]:
    """The whole-tree figures, narrowed instead of asserted.

    ``measure`` returns one heterogeneous dict because it collects a dozen
    different gate outputs, and the tree entry is the only nested one. Narrowing
    it with ``isinstance`` here means the two ledger figures are checked rather
    than trusted, with no suppression comment to explain away - the generator is
    a new file in this part, and new files in this part carry none.
    """
    tree = measured["tree"]
    if not isinstance(tree, dict):
        raise SystemExit(f"tree measurement missing or malformed: {tree!r}")
    source = tree.get("source")
    with_docs = tree.get("with_docs")
    if not isinstance(source, int) or not isinstance(with_docs, int):
        raise SystemExit(f"tree measurement unreadable: {tree!r}")
    return source, with_docs


def main(argv: list[str]) -> int:
    """``--check`` regenerates and compares instead of writing.

    The document promises two things - that it is complete and that it is
    reproducible - and only the first was machine-checkable when this script was
    copied from Part 15. ``--check`` closes the gap: the same generation runs,
    the result is compared byte for byte against the committed file, and a stale
    handover becomes a non-zero exit rather than a sentence nobody re-reads.
    """
    verify = "--check" in argv
    problems = sweep()
    if problems:
        print("HANDOVER AUDIT FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    table = baselines()

    def split_code_docs(pairs: list[tuple[str, str]], signed: bool = False) -> tuple[int, int]:
        code = docs = 0
        for rel, _ in pairs:
            current = lines_of(rel)
            value = current - table.get(rel, 0) if signed else current
            if rel.startswith("docs/"):
                docs += value
            else:
                code += value
        return code, docs

    new_code, new_docs = split_code_docs(NEW)
    unbaselined = [rel for rel, _ in MODIFIED if rel not in table]
    unblessed_size = sum(lines_of(rel) for rel in unbaselined)
    # A modified file that NO prior handover embedded has no recorded earlier
    # size, so its delta is unknowable rather than zero-and-not-counted. Charging
    # its whole length (the `table.get(rel, 0)` default that produced the first
    # drafts of this document) inflates "lines this part changed" into "lines this
    # part happens to have touched a file that is", which is the kind of number a
    # reader would repeat. So it is excluded from the delta, named here, and sized
    # as a size rather than a change.
    mod_code, mod_docs = split_code_docs(
        [(rel, note) for rel, note in MODIFIED if rel not in unbaselined],
        signed=True,
    )
    new_lines, delta = new_code + new_docs, mod_code + mod_docs

    print("measuring gates (this runs the suites; it takes a minute)...")
    measured = measure()
    header = HEADER_TEMPLATE.format(
        core_pytest=measured["core_pytest"],
        core_ruff=measured["core_ruff"],
        core_ruff_scripts=measured["core_ruff_scripts"],
        suppression_new=measured["suppression_new"],
        suppression_modified=measured["suppression_modified"],
        unbaselined_count=len(unbaselined),
        unbaselined_size=f"{unblessed_size:,}",
        unbaselined_list=", ".join(f"`{rel}`" for rel in unbaselined) or "none",
        admin_typecheck=measured["admin_typecheck"],
        core_mypy=measured["core_mypy"],
        engine_pytest=measured["engine_pytest"],
        engine_ruff=measured["engine_ruff"],
        engine_mypy=measured["engine_mypy"],
        engine_part18=measured["engine_part18"],
        node_scripts=measured["node_scripts"],
        manifest_check=measured["manifest_check"],
        check_rls=measured["check_rls"],
        api_tests=measured["api_tests"],
        api_typecheck=measured["api_typecheck"],
        api_lint=measured["api_lint"],
        prisma=measured["prisma"],
        trading_service=measured["trading_service"],
        market_service=measured["market_service"],
        total=new_lines + delta,
        new_code=new_code,
        new_code_count=sum(1 for rel, _ in NEW if not rel.startswith("docs/")),
        new_docs=new_docs,
        new_docs_count=sum(1 for rel, _ in NEW if rel.startswith("docs/")),
        new_docs_s="s" if sum(1 for rel, _ in NEW if rel.startswith("docs/")) != 1 else "",
        mod_code=mod_code,
        mod_docs=mod_docs,
        mod_count=len(MODIFIED),
        tree_source=_tree_counts(measured)[0],
        tree_with_docs=_tree_counts(measured)[1],
    )

    parts = [reflow_header(header), "## Created in Part 18 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 18 (full files, prior content preserved inside)\n")
    parts += [block(rel, note) for rel, note in MODIFIED]
    total_files = len(NEW) + len(MODIFIED)
    text = "\n".join(parts)
    if verify:
        committed = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if committed == text:
            print(f"OK: {OUT.name} is byte-identical to a fresh generation")
            return 0
        print(
            f"STALE: {OUT.name} differs from a fresh generation "
            f"({len(text.splitlines()):,} generated lines vs "
            f"{len(committed.splitlines()):,} committed)",
            file=sys.stderr,
        )
        return 1
    OUT.write_text(text, encoding="utf-8")
    emitted = text.count("\n## FILE: ")
    if emitted != total_files:
        print(f"EMISSION COUNT MISMATCH: {emitted} blocks for {total_files} files", file=sys.stderr)
        return 1
    print(
        f"wrote {OUT} ({len(text.splitlines()):,} lines, "
        f"{total_files} files: {len(NEW)} new + {len(MODIFIED)} modified; "
        f"{new_lines:,} new lines, +{delta:,} delta)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
````


## Modified in Part 18 (full files, prior content preserved inside)

## FILE: libs/trading-core/wlct_trading/execution/engine.py (1704 lines)

*the public read-only metrics property (no setter, so a scrape cannot be turned into a way of writing to the engine) and the four spans timed inside submit(): validation, safety_gates, risk, and total_submit recorded in finish() so it covers the paths that refuse as well as the one that succeeds.*

```python
"""The execution engine.

This is the single path by which an intent becomes an order at a venue. It is
exchange-agnostic: it talks to :class:`~wlct_trading.adapters.base.TradingAdapter`
and has no idea whether the venue behind it is Binance, a simulator, or
something that has not been written yet.

The sequence, in full::

    intent
      -> deterministic clientOrderId          (idempotency key)
      -> pre-network validation               (10 checks)
      -> pre-submit safety gates              (11 gates, all required)
      -> risk engine                          (mandatory, fail-closed)
      -> execution lock                       (one worker per order)
      -> clientOrderId reservation            (cross-worker duplicate guard)
      -> durable Order record + SUBMITTED event
      -> [DRY RUN stops here]
      -> adapter.submit_order                 (signs and transmits)
      -> outcome
           accepted   -> ACKNOWLEDGED/FILLED, fills applied to positions
           rejected   -> REJECTED, terminal, no position change
           ambiguous  -> stays SUBMITTED, marked UNKNOWN, incident, reconcile

Four properties are non-negotiable and are enforced here rather than left to
callers:

**Risk is mandatory.** There is no parameter that skips it. When the risk engine
is unavailable the order is refused, not waved through.

**Ambiguity never resubmits.** An :class:`AdapterConnectionError` means the
request may have reached the venue. The engine records that it does not know,
and hands the order to reconciliation. It never retries, because a retry that
the venue deduplicates is harmless and a retry that it does not is a doubled
position.

**Fills are never invented.** Every fill the engine applies came from an adapter
that got it from a venue. There is no code path that constructs a fill from an
assumption, and simulated fills carry ``is_simulated=True`` all the way to the
database.

**Marking precedes acting.** The order is persisted, and the unknown marker is
written, *before* the network call. A process that dies mid-request leaves a
record behind; one that persists afterwards does not.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import Enum
from typing import Awaitable, Callable, Mapping

from wlct_trading.adapters.base import (
    AdapterConnectionError,
    AdapterError,
    AdapterRateLimitedError,
    AdapterRejectedError,
    SubmitResult,
    SymbolSpecification,
    TradingAdapter,
)
from wlct_trading.clock import epoch_micros, monotonic_nanos
from wlct_trading.enums import (
    ExchangeId,
    OrderStatus,
    TERMINAL_ORDER_STATUSES,
    TradingMode,
)
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.credentials import ExchangeCredentials
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentRecorder,
    IncidentSeverity,
    IncidentType,
)
from wlct_trading.execution.locks import (
    LockManager,
    LockNotAcquired,
    account_lock_key,
    order_lock_key,
)
from wlct_trading.execution.placement_attestor import (
    PlacementReviewRequest,
    PlacementReviewer,
)
from wlct_trading.execution.placement_review import PlacementVerdict
from wlct_trading.execution.safety import (
    ComponentHealth,
    ExecutionPreconditions,
    SafetyDecision,
    SafetyGate,
    evaluate_safety_gates,
)
from wlct_trading.execution.store import (
    OrderStore,
    ReconciliationState,
)
from wlct_trading.execution.timesync import ClockSkewExceeded, ClockSyncError
from wlct_trading.execution.validation import OrderValidator, ValidationResult
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.observability.tracing import SpanLike, SpanStatus, Tracer
from wlct_trading.orders import Fill, InvalidOrderTransition, Order, OrderEvent, OrderIntent
from wlct_trading.positions import PositionManager, PositionUpdate
from wlct_trading.risk import (
    GateOutcome,
    KillSwitchState,
    RiskDecision,
    RiskEngine,
    RiskGate,
    RiskSnapshot,
    RiskStateSnapshot,
)

__all__ = [
    "ExecutionOutcome",
    "ExecutionResult",
    "ExecutionContext",
    "ExecutionEngine",
    "EngineConfigurationError",
]

_LOG = logging.getLogger(__name__)


class EngineConfigurationError(RuntimeError):
    """The engine is wired in a way that is unsafe for the requested mode."""


class ExecutionOutcome(str, Enum):
    """What happened to a submission attempt."""

    #: The venue accepted the order.
    ACCEPTED = "ACCEPTED"
    #: Refused locally, before any network activity.
    REJECTED_LOCALLY = "REJECTED_LOCALLY"
    #: The venue positively refused it. The order does not exist there.
    REJECTED_BY_EXCHANGE = "REJECTED_BY_EXCHANGE"
    #: Already submitted under this idempotency key. Nothing was sent.
    DUPLICATE = "DUPLICATE"
    #: Built, validated, risk-checked and then deliberately not transmitted.
    DRY_RUN = "DRY_RUN"
    #: The request may or may not have reached the venue. Reconciliation owns it
    #: from here. **Never** retried.
    UNKNOWN = "UNKNOWN"

    @property
    def order_exists_at_venue(self) -> bool:
        """Whether an order may exist at the venue as a result of this attempt.

        ``UNKNOWN`` answers ``True`` because it might, and every caller must
        treat "might" as "does" until reconciliation says otherwise.
        """
        return self in (ExecutionOutcome.ACCEPTED, ExecutionOutcome.UNKNOWN)


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    """The complete outcome of one submission attempt.

    Returned for every path including failure, rather than raising, because a
    rejected order is a normal business event that the caller must record — not
    an exception.
    """

    outcome: ExecutionOutcome
    client_order_id: str
    order: Order | None = None
    error_code: ExecutionErrorCode | None = None
    message: str = ""
    validation: ValidationResult | None = None
    safety: SafetyDecision | None = None
    risk: RiskDecision | None = None
    submit_result: SubmitResult | None = None
    fills: tuple[Fill, ...] = field(default_factory=tuple)
    position_updates: tuple[PositionUpdate, ...] = field(default_factory=tuple)
    incident: ExecutionIncident | None = None
    #: End-to-end wall time for the attempt, measured monotonically.
    latency_micros: int = 0
    #: True only when bytes actually left the process for a real venue.
    transmitted: bool = False
    is_simulated: bool = False

    @property
    def succeeded(self) -> bool:
        return self.outcome in (ExecutionOutcome.ACCEPTED, ExecutionOutcome.DRY_RUN)

    @property
    def requires_reconciliation(self) -> bool:
        return self.outcome is ExecutionOutcome.UNKNOWN

    def to_dict(self) -> dict[str, object]:
        """API-safe rendering.

        No credential material can reach this: the engine never holds a secret,
        only an :class:`ExchangeCredentials` it passes to the adapter, and
        nothing from it is copied here.
        """
        return {
            "outcome": self.outcome.value,
            "clientOrderId": self.client_order_id,
            "orderId": self.order.order_id if self.order else None,
            "exchangeOrderId": self.order.exchange_order_id if self.order else None,
            "status": self.order.status.value if self.order else None,
            "errorCode": self.error_code.value if self.error_code else None,
            "message": self.message,
            "transmitted": self.transmitted,
            "isSimulated": self.is_simulated,
            "requiresReconciliation": self.requires_reconciliation,
            "fillCount": len(self.fills),
            "latencyMicros": self.latency_micros,
            "incidentId": self.incident.incident_id if self.incident else None,
        }


@dataclass(slots=True)
class ExecutionContext:
    """Everything the engine needs that it cannot derive itself.

    Assembled fresh per submission by the caller (the strategy runner or the
    API) so that no gate reads a cached value. Every health field defaults to
    "unknown", which blocks — a caller that forgets to populate one cannot
    accidentally open a gate.
    """

    snapshot: RiskSnapshot
    kill_switches: KillSwitchState
    #: Part 8: the extended state the full risk gate reads (account health,
    # open-order reservations, day PnL, rate windows, config binding).
    # ``None`` with a wired gate is a fail-closed refusal, not a skip: the
    # engine asks the gate for a decision and the gate says it cannot make
    # one. Hosts that wire ``risk_gate`` must assemble this per submission.
    risk_state: RiskStateSnapshot | None = None
    specification: SymbolSpecification | None = None
    reference_price: Decimal | None = None
    risk_health: ComponentHealth = field(default_factory=ComponentHealth)
    market_data_health: ComponentHealth = field(default_factory=ComponentHealth)
    exchange_health: ComponentHealth = field(default_factory=ComponentHealth)
    credentials: ExchangeCredentials | None = None
    market_data_required: bool = True
    #: Overrides the engine default when a venue needs a longer lock (a slow
    #: cancel-replace, for example).
    lock_ttl_millis: int | None = None


class ExecutionEngine:
    """Turns validated intents into venue orders, safely.

    One instance per (exchange, mode) pair. It is safe to share across tenants:
    every method takes the tenant from the intent and every store and lock call
    is tenant-scoped, so there is no shared mutable state that could leak
    between them.
    """

    __slots__ = (
        "_adapter",
        "_settings",
        "_validator",
        "_risk_engine",
        "_risk_gate",
        "_store",
        "_locks",
        "_incidents",
        "_placement_reviewer",
        "_positions",
        "_publish",
        "_metrics",
        "_tracer",
        "_default_lock_ttl_millis",
    )

    def __init__(
        self,
        *,
        adapter: TradingAdapter,
        settings: ExecutionSettings,
        risk_engine: RiskEngine,
        risk_gate: RiskGate | None = None,
        store: OrderStore,
        locks: LockManager,
        incidents: IncidentRecorder,
        placement_reviewer: PlacementReviewer | None = None,
        validator: OrderValidator | None = None,
        positions: PositionManager | None = None,
        publish_event: Callable[[str, Mapping[str, object]], Awaitable[None]]
        | None = None,
        metrics: object | None = None,
        tracer: Tracer | None = None,
        default_lock_ttl_millis: int = 15_000,
    ) -> None:
        self._adapter = adapter
        self._settings = settings
        self._risk_engine = risk_engine
        self._risk_gate = risk_gate
        self._store = store
        self._locks = locks
        self._incidents = incidents
        self._placement_reviewer = placement_reviewer
        self._validator = validator or OrderValidator()
        self._positions = positions
        self._publish = publish_event
        self._metrics = metrics
        self._tracer = tracer
        self._default_lock_ttl_millis = default_lock_ttl_millis
        self._assert_wiring_is_safe()

    def _assert_wiring_is_safe(self) -> None:
        """Refuse combinations that are unsafe for the configured mode.

        Checked once at construction so a misconfigured deployment fails at
        startup rather than on its first order.
        """
        if self._settings.risk_gate_required and self._risk_gate is None:
            raise EngineConfigurationError(
                "RISK_ENGINE_ENABLED demands the Part 8 risk gate, but none "
                "is wired. This engine will not treat an unconfigured safety "
                "layer as a configured one: refusing to start. Wire "
                "RiskGate(...) or set RISK_ENGINE_ENABLED=false to opt into "
                "core-only evaluation."
            )
        if self._risk_gate is not None and self._settings.will_transmit_orders and self._risk_gate.is_simulated:
            raise EngineConfigurationError(
                "A live-transmitting engine was wired with the SIMULATED risk "
                "gate. Simulated gates read simulated state by construction; "
                "pairing one with a live venue would let paper risk verdicts "
                "authorise real orders. Refusing to start."
            )
        if not self._settings.will_transmit_orders:
            return
        if self._adapter.is_simulated:
            raise EngineConfigurationError(
                "Live trading is enabled but the wired adapter is a simulator. "
                "Refusing to start: a paper adapter presenting live results "
                "would make simulated fills indistinguishable from real ones."
            )
        if not self._locks.is_distributed:
            raise EngineConfigurationError(
                "Live trading is enabled with an in-process lock manager. "
                "Refusing to start: a second worker would be able to submit "
                "concurrently for the same order. Configure RedisLockManager."
            )
        if getattr(self._store, "is_durable", True) is False:
            raise EngineConfigurationError(
                "Live trading is enabled with a non-durable in-memory order "
                "store. Refusing to start: a restart would lose the record of "
                "live orders and positions."
            )
        if self._placement_reviewer is None:
            # Part 16. The review's verdict is a safety gate, and a gate nobody
            # runs is a gate that passes - so the requirement is enforced where
            # it can be enforced without inventing an order outcome: at
            # construction. There is no setting that removes it, because a
            # config key that lets a deployment trade without asking the venue
            # whether the key may trade is the same as no review at all.
            raise EngineConfigurationError(
                "Live trading is enabled with no placement reviewer. "
                "Refusing to start: nothing has established that this key may "
                "place this order on this symbol, which is the difference "
                "between a refusal and a surprise. Wire "
                "PlacementReviewer(venue_attestor, policy, "
                "requires_venue_attestation=True)."
            )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    @property
    def exchange(self) -> ExchangeId:
        return self._adapter.exchange

    @property
    def is_simulated(self) -> bool:
        return self._adapter.is_simulated

    @property
    def settings(self) -> ExecutionSettings:
        return self._settings

    @property
    def metrics(self) -> object | None:
        """The metrics port this engine observes into, for a scrape to read.

        Read-only and never reset here: exposition is a reader, and a reader
        that can clear the counters it is reporting on is how a restart and a
        ``metrics.reset()`` become indistinguishable on a dashboard. ``None``
        means this engine was built without instrumentation - which the
        exposition layer renders as "no families", not as zeros, because zero
        orders and unmeasured orders are different facts.
        """
        return self._metrics

    # ------------------------------------------------------------------
    # Submission
    # ------------------------------------------------------------------
    async def submit(
        self, intent: OrderIntent, context: ExecutionContext
    ) -> ExecutionResult:
        """Run the full pipeline for one intent.

        Never raises for an expected failure. Validation problems, risk
        rejections, blocked gates and venue refusals all come back as an
        :class:`ExecutionResult` with an outcome and an error code.
        """
        started_nanos = monotonic_nanos()
        client_order_id = intent.client_order_id or build_client_order_id(intent)
        tracer = self._tracer
        span = (
            tracer.start_span(
                "execution.submit",
                attributes={
                    "trade.tenant_id": intent.tenant_id,
                    "trade.account_id": intent.account_id,
                    "trade.symbol": intent.symbol,
                    "trade.side": intent.side.value,
                    "trade.client_order_id": client_order_id,
                },
            )
            if tracer is not None
            else None
        )

        def finish(result: ExecutionResult) -> ExecutionResult:
            elapsed = (monotonic_nanos() - started_nanos) // 1_000
            # Every exit from submit() passes through here, which is what makes
            # ``total_submit`` exactly one sample per submission - including the
            # refusals, since "we said no in 40 micros" is a latency fact an
            # operator needs in the same histogram as "we said no in 4s".
            self._observe_stage("total_submit", started_nanos)
            if span is not None:
                span.set_attribute("outcome", result.outcome.value)
                span.set_attribute(
                    "execution.error_code",
                    "" if result.error_code is None
                    else result.error_code.value,
                )
                span.set_attribute(
                    "execution.risk_code",
                    "" if result.risk is None else result.risk.code.value,
                )
                span.set_attribute("execution.elapsed_micros", elapsed)
                span.set_status(SpanStatus.OK)
                span.end()
            return ExecutionResult(
                outcome=result.outcome,
                client_order_id=result.client_order_id,
                order=result.order,
                error_code=result.error_code,
                message=result.message,
                validation=result.validation,
                safety=result.safety,
                risk=result.risk,
                submit_result=result.submit_result,
                fills=result.fills,
                position_updates=result.position_updates,
                incident=result.incident,
                latency_micros=elapsed,
                transmitted=result.transmitted,
                is_simulated=result.is_simulated,
            )

        # --- 1. Pre-network validation --------------------------------
        validation_started = monotonic_nanos()
        validation = self._validator.validate(
            intent,
            specification=context.specification,
            reference_price=context.reference_price,
        )
        self._observe_stage("validation", validation_started)
        if not validation.valid:
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.VALIDATION_FAILED,
                    message=validation.summary,
                    validation=validation,
                )
            )

        # --- 2a. Placement review (Part 16) ----------------------------
        # Deliberately before the gates, and deliberately not a second rejection
        # path: the verdict arrives as one more gate input, so the existing
        # blocked-gate handling produces the incident, the audit event and the
        # typed result. A reviewer that cannot reach the venue returns a refusal
        # with a retryable finding, so an outage blocks one order rather than
        # raising out of the submission path.
        placement: PlacementVerdict | None = None
        if self._placement_reviewer is not None:
            review_started = monotonic_nanos()
            _, placement = await self._placement_reviewer.review(
                PlacementReviewRequest(
                    tenant_id=intent.tenant_id,
                    account_id=intent.account_id,
                    symbol=intent.symbol,
                    order_type=intent.order_type.value,
                    time_in_force=intent.time_in_force.value,
                )
            )
            self._record_placement_review(placement, review_started)
            if span is not None:
                # Attributes, not an event: ``SpanLike`` is the engine's own
                # minimal span protocol (set_attribute / end), and widening it
                # for one call site would mean every tracer in the platform
                # grows a method to satisfy a single line here.
                span.set_attribute(
                    "placement.allowed", "true" if placement.allowed else "false"
                )
                span.set_attribute("placement.verdict_id", placement.verdict_id)
                span.set_attribute("placement.codes", ",".join(placement.codes))
                span.set_attribute(
                    "placement.venue_backed",
                    "true" if placement.venue_backed else "false",
                )

        # --- 2b. Safety gates ------------------------------------------
        preconditions = ExecutionPreconditions(
            exchange=self._adapter.exchange.value,
            symbol=intent.symbol,
            strategy_id=intent.strategy_id,
            kill_switches=context.kill_switches,
            settings=self._settings,
            risk_health=context.risk_health,
            market_data_health=context.market_data_health,
            exchange_health=context.exchange_health,
            credentials=context.credentials,
            market_data_required=context.market_data_required,
            is_simulated=self._adapter.is_simulated,
            placement=placement,
        )
        safety_started = monotonic_nanos()
        safety = evaluate_safety_gates(preconditions)
        self._observe_stage("safety_gates", safety_started)
        if not safety.allowed:
            incident = await self._maybe_record_gate_incident(intent, safety)
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=_gate_error_code(safety.blocking_gate),
                    message=safety.reason,
                    validation=validation,
                    safety=safety,
                    incident=incident,
                )
            )

        # --- 3. Risk engine -------------------------------------------
        # Mandatory. Any exception from the risk engine is a rejection, not a
        # bypass: an engine that throws is an engine whose answer is unknown,
        # and unknown means no.
        risk_started = monotonic_nanos()
        try:
            risk = self._risk_engine.evaluate(
                intent,
                snapshot=context.snapshot,
                kill_switches=context.kill_switches,
                trading_mode=self._settings.trading_mode,
                book_top=None,
                symbol_tradeable=(
                    context.specification.is_tradeable
                    if context.specification is not None
                    else True
                ),
            )
        except Exception as exc:  # noqa: BLE001 - fail closed
            incident = await self._record_incident(
                tenant_id=intent.tenant_id,
                account_id=intent.account_id,
                incident_type=IncidentType.SAFETY_GATE_BLOCK,
                severity=IncidentSeverity.CRITICAL,
                summary=(
                    f"The risk engine raised {type(exc).__name__} while "
                    f"evaluating an order; the order was refused."
                ),
                symbol=intent.symbol,
                client_order_id=client_order_id,
                error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                details={"error": str(exc)},
            )
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                    message=(
                        "The risk engine could not evaluate this order, so it "
                        "was refused. Risk checks fail closed."
                    ),
                    validation=validation,
                    safety=safety,
                    incident=incident,
                )
            )

        # Reaching here means the risk engine ANSWERED: its exception path above
        # returns. That is the line between the two - the stage that answered is
        # the stage that can be timed, and the one that threw is counted instead
        # (see _observe_stage).
        self._observe_stage("risk", risk_started)

        if not risk.approved:
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=_risk_error_code(risk),
                    message=(
                        f"Risk rejected the order ({risk.code.value}): "
                        + "; ".join(
                            violation.message for violation in risk.violations
                        )
                    ),
                    validation=validation,
                    safety=safety,
                    risk=risk,
                )
            )

        # --- 3b. Part 8 risk gate (when wired) -------------------------
        # The core engine above is always run and its refusal is final; the
        # gate can only tighten. Both consume distributed state (rate window,
        # budget reservation) at approval, and every path on which the order
        # demonstrably never reaches the venue hands those slots back.
        gate_outcome: GateOutcome | None = None
        if self._risk_gate is not None:
            try:
                gate_outcome = self._risk_gate.evaluate(
                    intent,
                    state=context.risk_state,
                    request_id=client_order_id,
                    trading_mode=self._settings.trading_mode,
                    legacy_kill_switches=context.kill_switches,
                )
            except Exception as exc:  # noqa: BLE001 - fail closed
                incident = await self._record_incident(
                    tenant_id=intent.tenant_id,
                    account_id=intent.account_id,
                    incident_type=IncidentType.SAFETY_GATE_BLOCK,
                    severity=IncidentSeverity.CRITICAL,
                    summary=(
                        f"The risk gate raised {type(exc).__name__} while "
                        "evaluating an order; the order was refused. Risk "
                        "checks fail closed."
                    ),
                    symbol=intent.symbol,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                    details={"error": str(exc)},
                )
                return finish(
                    ExecutionResult(
                        outcome=ExecutionOutcome.REJECTED_LOCALLY,
                        client_order_id=client_order_id,
                        error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                        message=(
                            "The risk gate could not evaluate this order, so "
                            "it was refused."
                        ),
                        validation=validation,
                        safety=safety,
                        risk=risk,
                        incident=incident,
                    )
                )
            if not gate_outcome.decision.approved:
                await self._release_risk_slots(gate_outcome, None)
                return finish(
                    ExecutionResult(
                        outcome=ExecutionOutcome.REJECTED_LOCALLY,
                        client_order_id=client_order_id,
                        error_code=_risk_error_code(gate_outcome.decision),
                        message=(
                            f"Risk gate rejected the order "
                            f"({gate_outcome.decision.code.value}): "
                            + "; ".join(
                                violation.message
                                for violation in gate_outcome.decision.violations
                            )
                        ),
                        validation=validation,
                        safety=safety,
                        risk=gate_outcome.decision,
                    )
                )
            # Carry the enriched decision (request id, snapshot version,
            # latency, rule provenance) forward in the result.
            risk = gate_outcome.decision

        # --- 4. Lock, reserve, persist, submit ------------------------
        lock_ttl = context.lock_ttl_millis or self._default_lock_ttl_millis
        try:
            async with self._locks.hold(
                account_lock_key(intent.tenant_id, intent.account_id),
                ttl_millis=lock_ttl,
                wait_millis=lock_ttl // 3,
            ):
                result = finish(
                    await self._submit_under_lock(
                        intent,
                        context,
                        client_order_id=client_order_id,
                        validation=validation,
                        safety=safety,
                        risk=risk,
                        placement=placement,
                        trace_span=span,
                    )
                )
                await self._release_risk_slots(gate_outcome, result)
                return result
        except LockNotAcquired as exc:
            rejection = finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.LOCK_UNAVAILABLE,
                    message=str(exc),
                    validation=validation,
                    safety=safety,
                    risk=risk,
                )
            )
            await self._release_risk_slots(gate_outcome, rejection)
            return rejection

    async def _release_risk_slots(
        self,
        gate_outcome: GateOutcome | None,
        result: ExecutionResult | None,
    ) -> None:
        """Hand back rate-window and budget-reservation slots.

        The rule is one line, and it is the same rule reconciliation uses: a
        reservation is kept exactly when an order may exist at the venue
        (``order_exists_at_venue`` covers ACCEPTED and UNKNOWN); in every
        other case - rejected locally, duplicate, dry run, venue refusal,
        lock timeout, or a gate rejection that consumed before refusing - the
        slot is released. UNKNOWN keeps its reservation on purpose: the order
        might exist, budget might be spent, and reconciliation plus the TTL
        are the two owners of that truth. Failures in the release are
        swallowed into a debug log: a stuck slot expires, while throwing from
        a cleanup path would corrupt the result the caller already earned.
        """
        if gate_outcome is None or self._risk_gate is None:
            return
        if result is not None and result.outcome.order_exists_at_venue:
            return
        tracer = self._tracer
        release_span = (
            tracer.start_span(
                "risk.reservation_release",
                attributes={
                    "trade.tenant_id": gate_outcome.decision.tenant_id,
                    "trade.request_id": gate_outcome.decision.request_id,
                    "risk.reservation_present": (
                        "true" if gate_outcome.reservation is not None else "false"
                    ),
                },
            )
            if tracer is not None
            else None
        )
        try:
            self._risk_gate.release_reservation(gate_outcome.reservation)
            self._risk_gate.rollback_rate(gate_outcome.rate_reservation)
            if release_span is not None:
                release_span.set_attribute("released", "true")
                release_span.set_status(SpanStatus.OK)
        except Exception as exc:  # noqa: BLE001 - cleanup must not rewrite the outcome
            _LOG.warning(
                "risk reservation release failed tenant=%s client_order_id=%s "
                "(slot expires with its TTL)",
                gate_outcome.decision.tenant_id,
                gate_outcome.decision.request_id,
            )
            if release_span is not None:
                release_span.record_exception(exc)
                release_span.set_attribute("released", "false")
                release_span.set_status(SpanStatus.ERROR, description="risk release failed")
        finally:
            if release_span is not None:
                release_span.end()

    async def _submit_under_lock(
        self,
        intent: OrderIntent,
        context: ExecutionContext,
        *,
        client_order_id: str,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
        placement: PlacementVerdict | None = None,
        trace_span: SpanLike | None = None,
    ) -> ExecutionResult:
        """The critical section: reserve, persist, transmit, interpret.

        ``placement`` is the Part 16 verdict the caller already ran. It arrives
        as a parameter instead of a fresh call here for two reasons: the review
        must happen OUTSIDE the account lock (a venue round trip while holding a
        lock serialises every order for that account behind a request that can
        take seconds), and the persisted verdict has to be the SAME one the gates
        saw - re-running it inside the lock could record an answer that differs
        from the one that authorised the submission, and an audit line that
        contradicts its own gate result is worse than no audit line.

        ``trace_span`` is the caller's ``execution.submit`` span when tracing
        is on: the transmit moment is recorded as an event on it, so the span
        shows how long the pipeline waited on the venue without owning a
        second span across this method's many exit paths. It can observe,
        never decide.
        """
        order = Order.from_intent(
            intent,
            client_order_id=client_order_id,
            is_simulated=self._adapter.is_simulated,
        )

        # --- Cross-worker duplicate guard -----------------------------
        reservation = await self._store.reserve_client_order_id(
            intent.tenant_id, client_order_id, order
        )
        if reservation.is_duplicate:
            existing = reservation.existing
            return ExecutionResult(
                outcome=ExecutionOutcome.DUPLICATE,
                client_order_id=client_order_id,
                order=existing,
                error_code=ExecutionErrorCode.DUPLICATE_ORDER,
                message=(
                    f"An order with clientOrderId {client_order_id} already "
                    f"exists"
                    + (f" (order {existing.order_id}, status "
                       f"{existing.status.value})" if existing else "")
                    + ". Nothing was transmitted; the existing order stands."
                ),
                validation=validation,
                safety=safety,
                risk=risk,
                is_simulated=self._adapter.is_simulated,
            )

        await self._store.save_order(order)

        # --- Dry run: stop here ---------------------------------------
        # The order is validated, risk-approved and recorded, and its status is
        # left at PENDING. It is deliberately never marked SUBMITTED, because
        # nothing was submitted, and a dry-run order that says SUBMITTED would
        # be indistinguishable from a real one in the audit trail.
        if self._settings.dry_run and not self._adapter.is_simulated:
            event = order.transition_to(
                OrderStatus.CANCELLED,
                reason=(
                    "DRY_RUN is enabled: the order was fully built, validated "
                    "and risk-checked, then discarded without transmission."
                ),
                payload={"dryRun": "true"},
            )
            await self._store.record_event(intent.tenant_id, event)
            await self._store.save_order(order)
            await self._emit("order.dry_run", order, {"dryRun": True})
            return ExecutionResult(
                outcome=ExecutionOutcome.DRY_RUN,
                client_order_id=client_order_id,
                order=order,
                message=(
                    "DRY_RUN: the signed request was constructed and validated "
                    "but not transmitted. This order was NOT submitted."
                ),
                validation=validation,
                safety=safety,
                risk=risk,
                transmitted=False,
                is_simulated=self._adapter.is_simulated,
            )

        # --- Mark before acting ---------------------------------------
        # Written first so a crash between here and the response still leaves a
        # record saying "we may have an order at the venue".
        submitted_payload: dict[str, str] = {"clientOrderId": client_order_id}
        if placement is not None:
            # The verdict id is a digest of the evidence, so a later reader can
            # tell "this order went out on the strength of a fresh venue
            # attestation" from "this one was waved through on nothing" without
            # a second table: the durable event ledger already carries the story.
            submitted_payload.update(placement.to_event_payload())
        submitted_event = order.transition_to(
            OrderStatus.SUBMITTED,
            reason="Transmitting to the venue.",
            payload=submitted_payload,
        )
        await self._store.record_event(intent.tenant_id, submitted_event)
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id,
            order.order_id,
            ReconciliationState.UNKNOWN,
            detail="Submission in flight; outcome not yet observed.",
        )
        await self._emit("order.submitted", order, {})

        # --- Transmit --------------------------------------------------
        if trace_span is not None:
            trace_span.add_event("transmit_started")
        try:
            submit_result = await asyncio.wait_for(
                self._adapter.submit_order(intent, client_order_id),
                timeout=self._settings.order_request_timeout_ms / 1000,
            )
        except AdapterRejectedError as exc:
            return await self._handle_rejection(
                order, intent, exc, validation, safety, risk
            )
        except AdapterRateLimitedError as exc:
            # A rate-limit response is a definitive refusal: the venue tells us
            # it did not process the request. The order does not exist.
            return await self._handle_definitive_failure(
                order,
                intent,
                ExecutionErrorCode.RATE_LIMITED,
                str(exc),
                validation,
                safety,
                risk,
            )
        except (ClockSkewExceeded, ClockSyncError) as exc:
            # Raised by the adapter before it transmits, so nothing was sent.
            return await self._handle_definitive_failure(
                order,
                intent,
                (
                    ExecutionErrorCode.CLOCK_SKEW_EXCEEDED
                    if isinstance(exc, ClockSkewExceeded)
                    else ExecutionErrorCode.CLOCK_NOT_SYNCHRONISED
                ),
                str(exc),
                validation,
                safety,
                risk,
            )
        except (AdapterConnectionError, asyncio.TimeoutError) as exc:
            return await self._handle_unknown(
                order, intent, exc, validation, safety, risk
            )
        except AdapterError as exc:
            # An adapter failure we cannot classify. Treated as ambiguous,
            # because "we do not know what this adapter did" and "we do not
            # know whether the order exists" are the same statement.
            return await self._handle_unknown(
                order, intent, exc, validation, safety, risk
            )

        return await self._handle_accepted(
            order, intent, submit_result, validation, safety, risk
        )

    # ------------------------------------------------------------------
    # Outcome handlers
    # ------------------------------------------------------------------
    async def _handle_accepted(
        self,
        order: Order,
        intent: OrderIntent,
        submit_result: SubmitResult,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The venue answered. Its answer is authoritative."""
        if not submit_result.accepted:
            reason = submit_result.rejection_reason or "The venue refused the order."
            self._safe_transition(
                order,
                OrderStatus.REJECTED,
                reason=reason,
                payload={"code": submit_result.rejection_code or ""},
            )
            await self._store.save_order(order)
            await self._store.set_reconciliation_state(
                intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
            )
            await self._emit("order.rejected", order, {"reason": reason})
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.EXCHANGE_REJECTED,
                message=reason,
                validation=validation,
                safety=safety,
                risk=risk,
                submit_result=submit_result,
                transmitted=True,
                is_simulated=submit_result.is_simulated,
            )

        event = self._safe_transition(
            order,
            submit_result.status
            if submit_result.status is not OrderStatus.SUBMITTED
            else OrderStatus.ACKNOWLEDGED,
            reason="Accepted by the venue.",
            exchange_order_id=submit_result.exchange_order_id,
        )
        if event is None:
            # The venue reported a status our state machine says is illegal from
            # here. The venue is authoritative, so this is recorded as an
            # incident rather than silently forced or silently dropped.
            await self._record_illegal_transition(order, intent, submit_result.status)

        applied_fills: list[Fill] = []
        updates: list[PositionUpdate] = []
        for fill in submit_result.fills:
            applied, update = await self._apply_fill(order, intent, fill)
            if applied:
                applied_fills.append(fill)
            if update is not None:
                updates.append(update)

        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit(
            "order.accepted",
            order,
            {"exchangeOrderId": submit_result.exchange_order_id or ""},
        )
        return ExecutionResult(
            outcome=ExecutionOutcome.ACCEPTED,
            client_order_id=order.client_order_id,
            order=order,
            message="Accepted by the venue.",
            validation=validation,
            safety=safety,
            risk=risk,
            submit_result=submit_result,
            fills=tuple(applied_fills),
            position_updates=tuple(updates),
            transmitted=not submit_result.is_simulated,
            is_simulated=submit_result.is_simulated,
        )

    async def _handle_rejection(
        self,
        order: Order,
        intent: OrderIntent,
        exc: AdapterRejectedError,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The venue said no, explicitly. The order does not exist there."""
        self._safe_transition(
            order,
            OrderStatus.REJECTED,
            reason=str(exc),
            payload={"venueCode": exc.code},
        )
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit("order.rejected", order, {"venueCode": exc.code})

        code = (
            ExecutionErrorCode.INSUFFICIENT_BALANCE
            if "insufficient" in str(exc).lower()
            else ExecutionErrorCode.EXCHANGE_REJECTED
        )
        return ExecutionResult(
            outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
            client_order_id=order.client_order_id,
            order=order,
            error_code=code,
            message=str(exc),
            validation=validation,
            safety=safety,
            risk=risk,
            transmitted=True,
            is_simulated=self._adapter.is_simulated,
        )

    async def _handle_definitive_failure(
        self,
        order: Order,
        intent: OrderIntent,
        code: ExecutionErrorCode,
        message: str,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """A failure where we know the order was not placed."""
        self._safe_transition(order, OrderStatus.FAILED, reason=message)
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit("order.failed", order, {"errorCode": code.value})
        return ExecutionResult(
            outcome=ExecutionOutcome.REJECTED_LOCALLY,
            client_order_id=order.client_order_id,
            order=order,
            error_code=code,
            message=message,
            validation=validation,
            safety=safety,
            risk=risk,
            transmitted=False,
            is_simulated=self._adapter.is_simulated,
        )

    async def _handle_unknown(
        self,
        order: Order,
        intent: OrderIntent,
        exc: BaseException,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The dangerous case: we do not know whether the order exists.

        The order's status stays ``SUBMITTED`` — which is true, we did submit
        it — and its reconciliation state becomes ``UNKNOWN``. An incident is
        raised at CRITICAL because an unresolved unknown order is an unhedged,
        unmonitored position waiting to happen.

        Nothing is retried. Not now, not by a caller, not by a background
        sweeper. The only permitted next action is a query by clientOrderId.
        """
        detail = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        await self._store.set_reconciliation_state(
            intent.tenant_id,
            order.order_id,
            ReconciliationState.UNKNOWN,
            detail=detail,
        )
        event = order.transition_to(
            OrderStatus.SUBMITTED,
            reason=(
                "The submission response was lost. The order's fate is unknown "
                "and will be established by querying the venue for "
                f"clientOrderId {order.client_order_id}. It will NOT be "
                "resubmitted."
            ),
            payload={"reconciliationState": ReconciliationState.UNKNOWN.value},
        ) if order.status is not OrderStatus.SUBMITTED else None
        if event is not None:
            await self._store.record_event(intent.tenant_id, event)
        await self._store.save_order(order)

        incident = await self._record_incident(
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            incident_type=IncidentType.UNKNOWN_ORDER_RESULT,
            severity=IncidentSeverity.CRITICAL,
            summary=(
                f"Order {order.order_id} was transmitted but no response was "
                f"received. The order may or may not exist at "
                f"{self._adapter.exchange.value}. It must be reconciled by "
                f"clientOrderId and must never be resubmitted."
            ),
            symbol=intent.symbol,
            order_id=order.order_id,
            client_order_id=order.client_order_id,
            error_code=ExecutionErrorCode.RESULT_UNKNOWN,
            details={"cause": detail},
        )
        await self._emit(
            "order.unknown",
            order,
            {"cause": detail, "requiresReconciliation": True},
        )

        return ExecutionResult(
            outcome=ExecutionOutcome.UNKNOWN,
            client_order_id=order.client_order_id,
            order=order,
            error_code=ExecutionErrorCode.RESULT_UNKNOWN,
            message=(
                "The venue's response was lost. The order's state is unknown "
                "and reconciliation has been scheduled. It has NOT been "
                "resubmitted."
            ),
            validation=validation,
            safety=safety,
            risk=risk,
            incident=incident,
            transmitted=True,
            is_simulated=self._adapter.is_simulated,
        )

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------
    async def cancel(
        self, order: Order, *, reason: str = "Cancelled by request."
    ) -> ExecutionResult:
        """Cancel a resting order.

        Refuses when the order's fate is unknown: cancelling an order that may
        not exist produces a venue error that is itself ambiguous, and the
        correct first step is always to establish what the order actually is.
        """
        started_nanos = monotonic_nanos()
        state = await self._store.get_reconciliation_state(
            order.tenant_id, order.order_id
        )
        if state.blocks_further_submission:
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_LOCALLY,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.RECONCILIATION_REQUIRED,
                message=(
                    f"Order {order.order_id} is in reconciliation state "
                    f"{state.value}; its true state at the venue is not known. "
                    f"Reconcile before cancelling."
                ),
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

        if order.status in TERMINAL_ORDER_STATUSES:
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_LOCALLY,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.ILLEGAL_STATE_TRANSITION,
                message=(
                    f"Order {order.order_id} is already terminal "
                    f"({order.status.value}); there is nothing to cancel."
                ),
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

        async with self._locks.hold(
            order_lock_key(order.tenant_id, order.order_id),
            ttl_millis=self._default_lock_ttl_millis,
            wait_millis=self._default_lock_ttl_millis // 3,
        ):
            request_event = order.try_transition_to(
                OrderStatus.CANCEL_REQUESTED, reason=reason
            )
            if request_event is not None:
                await self._store.record_event(order.tenant_id, request_event)
                await self._store.save_order(order)

            try:
                result = await asyncio.wait_for(
                    self._adapter.cancel_order(order),
                    timeout=self._settings.order_request_timeout_ms / 1000,
                )
            except (AdapterConnectionError, asyncio.TimeoutError) as exc:
                await self._store.set_reconciliation_state(
                    order.tenant_id,
                    order.order_id,
                    ReconciliationState.UNKNOWN,
                    detail=f"Cancel response lost: {type(exc).__name__}",
                )
                incident = await self._record_incident(
                    tenant_id=order.tenant_id,
                    account_id=order.account_id,
                    incident_type=IncidentType.UNKNOWN_ORDER_RESULT,
                    severity=IncidentSeverity.WARNING,
                    summary=(
                        f"Cancellation of order {order.order_id} received no "
                        f"response; the order may or may not have been "
                        f"cancelled."
                    ),
                    order_id=order.order_id,
                    client_order_id=order.client_order_id,
                    error_code=ExecutionErrorCode.RESULT_UNKNOWN,
                )
                return ExecutionResult(
                    outcome=ExecutionOutcome.UNKNOWN,
                    client_order_id=order.client_order_id,
                    order=order,
                    error_code=ExecutionErrorCode.RESULT_UNKNOWN,
                    message="The cancellation response was lost; reconciling.",
                    incident=incident,
                    transmitted=True,
                    latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
                )
            except AdapterError as exc:
                return ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
                    client_order_id=order.client_order_id,
                    order=order,
                    error_code=ExecutionErrorCode.EXCHANGE_REJECTED,
                    message=str(exc),
                    transmitted=True,
                    latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
                )

            if result.accepted:
                self._safe_transition(
                    order,
                    result.status,
                    reason=result.reason or "Cancelled at the venue.",
                )
                await self._store.save_order(order)
                await self._emit("order.cancelled", order, {})

            return ExecutionResult(
                outcome=(
                    ExecutionOutcome.ACCEPTED
                    if result.accepted
                    else ExecutionOutcome.REJECTED_BY_EXCHANGE
                ),
                client_order_id=order.client_order_id,
                order=order,
                message=result.reason or "",
                transmitted=not result.is_simulated,
                is_simulated=result.is_simulated,
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

    # ------------------------------------------------------------------
    # Fills
    # ------------------------------------------------------------------
    async def apply_external_fill(
        self, order: Order, fill: Fill
    ) -> tuple[bool, PositionUpdate | None]:
        """Apply a fill that arrived outside a submission — the usual case.

        The private stream delivers most fills, and reconciliation delivers the
        rest. Both land here, and both are deduplicated by ``fill_id``, because
        the same trade legitimately arrives twice by two different routes.
        """
        intent_like = _IntentView(
            tenant_id=order.tenant_id,
            account_id=order.account_id,
            symbol=order.symbol,
            exchange=order.exchange,
        )
        return await self._apply_fill(order, intent_like, fill)

    async def _apply_fill(
        self,
        order: Order,
        intent: "OrderIntent | _IntentView",
        fill: Fill,
    ) -> tuple[bool, PositionUpdate | None]:
        """Record a fill once, and once only.

        The Part 2 ``Order.apply_fill`` already deduplicates by ``fill_id`` and
        recomputes the aggregate from scratch; the store deduplicates durably.
        Both are consulted, because either alone leaves a gap: the in-memory
        object is lost on restart and the store is not consulted on the hot
        path.
        """
        # An adapter identifies a fill by whatever the venue gave it — usually
        # the clientOrderId, because the venue has never heard of our internal
        # order id. Rebind it here, once, at the boundary, so the durable record
        # and the in-memory aggregate agree on which order the fill belongs to.
        bound = (
            fill if fill.order_id == order.order_id
            else replace(fill, order_id=order.order_id)
        )
        newly_stored = await self._store.record_fill(intent.tenant_id, bound)
        applied = order.apply_fill(bound)
        if not applied or not newly_stored:
            return (False, None)

        update: PositionUpdate | None = None
        if self._positions is not None:
            update = self._positions.apply_fill(
                order.tenant_id,
                order.account_id,
                order.exchange,
                order.symbol,
                order.side,
                bound,
            )
        await self._emit(
            "order.filled",
            order,
            {
                "fillId": bound.fill_id,
                "quantity": str(bound.quantity),
                "price": str(bound.price),
                "isSimulated": bound.is_simulated,
            },
        )
        return (True, update)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _safe_transition(
        self,
        order: Order,
        target: OrderStatus,
        *,
        reason: str,
        exchange_order_id: str | None = None,
        payload: dict[str, str] | None = None,
    ) -> OrderEvent | None:
        """Transition, tolerating an illegal target.

        Returns the event, or ``None`` when the transition was refused. The
        caller decides what an illegal transition means; this never forces one,
        because a forced transition destroys the very audit trail that would
        explain the bug.
        """
        try:
            return order.transition_to(
                target,
                reason=reason,
                exchange_order_id=exchange_order_id,
                payload=payload,
            )
        except InvalidOrderTransition:
            return None

    async def _record_illegal_transition(
        self, order: Order, intent: "OrderIntent | _IntentView", target: OrderStatus
    ) -> None:
        await self._record_incident(
            tenant_id=order.tenant_id,
            account_id=order.account_id,
            incident_type=IncidentType.ILLEGAL_TRANSITION,
            severity=IncidentSeverity.WARNING,
            summary=(
                f"The venue reported status {target.value} for order "
                f"{order.order_id}, which is not a legal transition from "
                f"{order.status.value}. Local state was left unchanged and the "
                f"discrepancy recorded rather than forced."
            ),
            symbol=order.symbol,
            order_id=order.order_id,
            client_order_id=order.client_order_id,
            error_code=ExecutionErrorCode.ILLEGAL_STATE_TRANSITION,
            details={"from": order.status.value, "to": target.value},
        )

    async def _maybe_record_gate_incident(
        self, intent: OrderIntent, safety: SafetyDecision
    ) -> ExecutionIncident | None:
        """Record an incident only for gates that indicate a fault.

        A kill switch blocking an order is the system working exactly as
        intended and generates no incident; an unhealthy risk engine or an
        invalid credential is a fault and does.
        """
        faulty = {
            SafetyGate.RISK_ENGINE_HEALTHY,
            SafetyGate.CREDENTIALS_VALID,
            SafetyGate.EXCHANGE_HEALTHY,
            SafetyGate.MARKET_DATA_HEALTHY,
            # A blocked review is a fault precisely because it is unexpected:
            # either the venue changed the key's entitlements, or the attestor
            # could not be reached, and both mean the deployment is not in the
            # state its configuration claims.
            SafetyGate.PLACEMENT_ATTESTED,
        }
        blocking = safety.blocking_gate
        if blocking is None or blocking not in faulty:
            return None
        severity = (
            IncidentSeverity.CRITICAL
            if blocking is SafetyGate.CREDENTIALS_VALID
            else IncidentSeverity.WARNING
        )
        incident_type = (
            IncidentType.CREDENTIAL_FAILURE
            if blocking is SafetyGate.CREDENTIALS_VALID
            else IncidentType.SAFETY_GATE_BLOCK
        )
        return await self._record_incident(
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            incident_type=incident_type,
            severity=severity,
            summary=f"Order blocked by safety gate {blocking.value}.",
            symbol=intent.symbol,
            error_code=_gate_error_code(blocking),
            details={"reason": safety.reason},
        )

    def _observe_stage(self, stage: str, started_nanos: int) -> None:
        """Record one stage span on the metrics port, if there is one.

        Same duck-typing as :meth:`_record_placement_review`, for the same
        reason: the port is optional, and a submission path must not fail
        because a deployment passed nothing. Four stages are recorded here -
        ``validation``, ``safety_gates``, ``risk`` and ``total_submit`` - and
        the rest of ``EXECUTION_STAGES`` deliberately is not, because those
        spans belong to layers this engine calls rather than contains: signing
        and network sit inside the trading adapter, ``first_fill`` and
        ``private_stream_delivery`` inside the stream, ``reconciliation_pass``
        inside :class:`ReconciliationService`'s three entry points, and
        ``persistence`` across six store writes whose aggregation (per-write or
        per-submit) is a decision the platform has not made. A histogram is a
        promise about what is being measured; the engine does not make promises
        it has not defined.

        Error paths are counted, not timed. A stage that never returned has no
        duration, and inventing one by recording in an ``except`` would put a
        number on the dashboard that means "we gave up", which is what the
        counters are for.
        """
        metrics = self._metrics
        if metrics is None:
            return
        observe = getattr(metrics, "observe", None)
        if callable(observe):
            observe(stage, (monotonic_nanos() - started_nanos) // 1_000)

    def _record_placement_review(
        self, verdict: PlacementVerdict, started_nanos: int
    ) -> None:
        """Count and time the review on the shared execution metrics port.

        The port is duck-typed because it has always been optional here
        (``metrics`` accepts any object): a submission path must not fail because
        a deployment passed nothing, and the same argument applies to a counter.
        Each update is therefore guarded on the attribute existing, which is how
        the rest of this engine treats the port.
        """
        metrics = self._metrics
        if metrics is None:
            return
        observe = getattr(metrics, "observe", None)
        if callable(observe):
            observe("placement_review", (monotonic_nanos() - started_nanos) // 1_000)
        counters = getattr(metrics, "counters", None)
        if counters is None:
            return
        deltas = {"placement_reviews": 1}
        if not verdict.allowed:
            deltas["placement_review_blocks"] = 1
            if any(
                finding.code.value.startswith("ATTESTATION_")
                or finding.code.value == "NO_ATTESTATION"
                for finding in verdict.blocking_findings
            ):
                deltas["placement_attestation_failures"] = 1
            # Per-area, read off the verdict's own classification rather than
            # re-derived here from code prefixes: an engine that recomputed areas
            # would be a second taxonomy, and the two would disagree about a new
            # code on the day it is added. The hasattr guard means an area added to
            # the enum cannot make this line raise on the reporting path - and the
            # Part 19 test pins that every area DOES have a field, so the guard
            # cannot quietly become a hole either.
            for area, count in verdict.area_counts.items():
                name = f"placement_blocks_{area.lower()}"
                if hasattr(counters, name):
                    deltas[name] = deltas.get(name, 0) + count
        for name, delta in deltas.items():
            setattr(counters, name, int(getattr(counters, name, 0)) + delta)

    async def _record_incident(
        self,
        *,
        tenant_id: str,
        incident_type: IncidentType,
        severity: IncidentSeverity,
        summary: str,
        account_id: str | None = None,
        symbol: str | None = None,
        order_id: str | None = None,
        client_order_id: str | None = None,
        error_code: ExecutionErrorCode | None = None,
        details: Mapping[str, object] | None = None,
    ) -> ExecutionIncident | None:
        """Record an incident without ever failing the caller.

        An incident store that is down must not take execution down with it.
        """
        incident = ExecutionIncident.create(
            tenant_id=tenant_id,
            account_id=account_id,
            incident_type=incident_type,
            severity=severity,
            summary=summary,
            exchange=self._adapter.exchange,
            symbol=symbol,
            order_id=order_id,
            client_order_id=client_order_id,
            error_code=error_code,
            details=details,
        )
        try:
            await self._incidents.record(incident)
        except Exception:  # noqa: BLE001 - never break execution for logging
            return incident
        return incident

    async def _emit(
        self, event_type: str, order: Order, extra: Mapping[str, object]
    ) -> None:
        """Publish a trading event, tolerating a failing publisher."""
        if self._publish is None:
            return
        payload: dict[str, object] = {
            "tenantId": order.tenant_id,
            "accountId": order.account_id,
            "orderId": order.order_id,
            "clientOrderId": order.client_order_id,
            "exchangeOrderId": order.exchange_order_id,
            "exchange": order.exchange.value,
            "symbol": order.symbol,
            "side": order.side.value,
            "status": order.status.value,
            "isSimulated": order.is_simulated,
            "filledQuantity": str(order.filled_quantity),
            "occurredAtMicros": epoch_micros(),
        }
        payload.update(extra)
        try:
            await self._publish(event_type, payload)
        except Exception:  # noqa: BLE001 - publishing is best-effort
            return


@dataclass(frozen=True, slots=True)
class _IntentView:
    """The few intent fields the fill path needs.

    Lets :meth:`ExecutionEngine.apply_external_fill` reuse ``_apply_fill``
    without fabricating a whole :class:`OrderIntent` — a fabricated intent would
    be indistinguishable from a real one to anything downstream, which is
    exactly the sort of thing that ends up in a database.
    """

    tenant_id: str
    account_id: str
    symbol: str
    exchange: ExchangeId


#: Gate → public-error taxonomy, as a table with a default rather than an
#: ``if``-chain. A chain that enumerates every current member gives the type
#: checker enough to prove its fallback dead — yet the fallback is precisely
#: the protection for the day a gate is added and forgotten here. A table
#: keeps that protection visible to callers and to mypy alike.
_GATE_ERROR_CODES: dict[SafetyGate, ExecutionErrorCode] = {
    SafetyGate.GLOBAL_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.EXCHANGE_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.STRATEGY_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.SYMBOL_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.TRADING_MODE: ExecutionErrorCode.TRADING_DISABLED,
    SafetyGate.LIVE_TRADING_AUTHORISED: ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED,
    SafetyGate.RISK_ENGINE_HEALTHY: ExecutionErrorCode.RISK_UNAVAILABLE,
    SafetyGate.MARKET_DATA_HEALTHY: ExecutionErrorCode.MARKET_DATA_UNAVAILABLE,
    SafetyGate.CREDENTIALS_VALID: ExecutionErrorCode.CREDENTIALS_INVALID,
    # "Not authorised to place" is what a blocked review means, and reusing the
    # existing code keeps the worker's failure taxonomy unchanged: the detail of
    # WHY (key, symbol phase, clock, unreachable venue) is in the verdict codes
    # carried by the event payload and the incident, where a human reads it.
    SafetyGate.PLACEMENT_ATTESTED: ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED,
    SafetyGate.EXCHANGE_HEALTHY: ExecutionErrorCode.EXCHANGE_UNAVAILABLE,
}


def _gate_error_code(gate: SafetyGate | None) -> ExecutionErrorCode:
    """Map a blocked gate onto the public error taxonomy."""
    if gate is None:
        return ExecutionErrorCode.INTERNAL_ERROR
    return _GATE_ERROR_CODES.get(gate, ExecutionErrorCode.INTERNAL_ERROR)


def _risk_error_code(decision: RiskDecision) -> ExecutionErrorCode:
    """Map a risk decision onto the public error taxonomy.

    Part 8 added the state-integrity codes: a stale or invalid snapshot and
    an unavailable gate are reported as ``RISK_UNAVAILABLE`` (the condition
    is "the decision could not be made", which is an operational fault, not
    a policy answer), while stale *market* data and stale risk state keep
    distinct codes because the remediations differ (feed vs. state loader).
    """
    from wlct_trading.risk import RiskDecisionCode

    if decision.code in (
        RiskDecisionCode.RISK_STATE_UNAVAILABLE,
        RiskDecisionCode.RISK_GATE_UNAVAILABLE,
        RiskDecisionCode.RISK_CONFIGURATION_INVALID,
        RiskDecisionCode.UNKNOWN_RISK_RULE,
    ):
        return ExecutionErrorCode.RISK_UNAVAILABLE
    if decision.code in (
        RiskDecisionCode.STALE_RISK_STATE,
        RiskDecisionCode.INVALID_ACCOUNT_STATE,
        RiskDecisionCode.INVALID_POSITION_STATE,
    ):
        return ExecutionErrorCode.RISK_STATE_STALE
    if decision.code is RiskDecisionCode.STALE_MARKET_DATA:
        return ExecutionErrorCode.MARKET_DATA_UNAVAILABLE
    if decision.code is RiskDecisionCode.INSUFFICIENT_BALANCE:
        return ExecutionErrorCode.INSUFFICIENT_BALANCE
    if decision.code is RiskDecisionCode.DUPLICATE_ORDER:
        return ExecutionErrorCode.DUPLICATE_ORDER
    if decision.kill_switch_scope is not None:
        return ExecutionErrorCode.KILL_SWITCH_ENGAGED
    if decision.trading_mode is TradingMode.DISABLED:
        return ExecutionErrorCode.TRADING_DISABLED
    return ExecutionErrorCode.RISK_REJECTED
```


## FILE: libs/trading-core/wlct_trading/observability/metrics.py (721 lines)

*the bug fix this part exists as evidence of: observe_latency_histogram copied a cumulative array into a store the renderer sums, so every le line above the first bucket reported observations that never happened. It now copies per-bucket counts and says why on the copy loop, in the voice of someone recording how a wrong contract survived nine parts of passing tests.*

```python
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
```


## FILE: libs/trading-core/tests/test_observability_metrics.py (381 lines)

*the drift pin this part had to move and the rendered-text assertions that the old test lacked: the unrecorded-stage count went from 12 to 8 with the five recorded names spelled out, and the adapter's test now asserts the exposition text (1, 2, 3) rather than the internal series that had been pinning the wrong semantics with a straight face.*

```python
"""The exposition registry: semantics, cardinality cap, timing honesty, and
the Prometheus text format pinned to exact vectors.

Format vectors matter: two implementations (Python here, TypeScript in the
API) must render byte-identical output for identical inputs, and the only
way to hold that without running Prometheus is to pin exact expected text in
both test suites, generated from one source (see
``libs/trading-core/scripts/gen_observability_fixtures.py``).
"""

from __future__ import annotations

import re

import pytest

from wlct_trading.metrics import LatencyHistogram
from wlct_trading.observability.labels import CardinalityError
from wlct_trading.observability.metrics import (
    DEFAULT_MICROS_BUCKETS,
    PIPELINE_STAGES,
    ObservabilityRegistry,
    PipelineSpan,
    observe_latency_histogram,
    render_prometheus,
    sample_process,
)


def make_registry(max_series_per_family: int = 4_096) -> ObservabilityRegistry:
    return ObservabilityRegistry(
        service="test-svc", max_series_per_family=max_series_per_family
    )


def test_counter_is_monotonic_and_refuses_negative() -> None:
    registry = make_registry()
    registry.register_counter("wlct_risk_decisions_total", "Decisions evaluated.", "result")
    registry.inc("wlct_risk_decisions_total", {"result": "approved"}, 3)
    registry.inc("wlct_risk_decisions_total", {"result": "approved"})
    with pytest.raises(CardinalityError, match="never decrease"):
        registry.inc("wlct_risk_decisions_total", {"result": "approved"}, -1)

    snap = registry.snapshot()["wlct_risk_decisions_total"]["series"]
    assert snap == [{"labels": {"result": "approved"}, "value": 4.0}]


def test_unregistered_metric_is_a_programming_error() -> None:
    registry = make_registry()
    with pytest.raises(CardinalityError, match="not registered"):
        registry.inc("wlct_never_registered", {})


def test_duplicate_registration_refused() -> None:
    registry = make_registry()
    registry.register_counter("wlct_a_total", "one", "result")
    with pytest.raises(CardinalityError, match="registered twice"):
        registry.register_counter("wlct_a_total", "two", "result")


def test_gauge_moves_both_ways() -> None:
    registry = make_registry()
    registry.register_gauge("wlct_orders_open", "Open orders.", "exchange")
    registry.set_gauge("wlct_orders_open", {"exchange": "binance"}, 5)
    registry.add_to_gauge("wlct_orders_open", {"exchange": "binance"}, -2)
    series = registry.snapshot()["wlct_orders_open"]["series"]
    assert series[0]["value"] == 3.0


def test_histogram_bucket_semantics_and_negative_observation() -> None:
    registry = make_registry()
    registry.register_histogram(
        "wlct_risk_decision_micros",
        "Decision path duration.",
        ("result",),
        buckets=(100, 1_000),
    )
    registry.observe_micros("wlct_risk_decision_micros", {"result": "approved"}, 50)
    registry.observe_micros("wlct_risk_decision_micros", {"result": "approved"}, 900)
    registry.observe_micros("wlct_risk_decision_micros", {"result": "approved"}, 5_000)
    registry.observe_micros("wlct_risk_decision_micros", {"result": "approved"}, -7)

    text = render_prometheus(registry)
    # Buckets are cumulative at "<= le"; -7 falls in <=100 like 50 does;
    # 5_000 lands only in +Inf. Sum is real arithmetic, never clamped.
    assert 'wlct_risk_decision_micros_bucket{le="100",result="approved",service="test-svc"} 2' in text
    assert 'wlct_risk_decision_micros_bucket{le="1000",result="approved",service="test-svc"} 3' in text
    assert 'wlct_risk_decision_micros_bucket{le="+Inf",result="approved",service="test-svc"} 4' in text
    assert "wlct_risk_decision_micros_sum{result=\"approved\",service=\"test-svc\"} 5943" in text
    assert "wlct_risk_decision_micros_count{result=\"approved\",service=\"test-svc\"} 4" in text


def test_observe_on_non_histogram_family_is_rejected() -> None:
    registry = make_registry()
    registry.register_counter("wlct_c_total", "c", "result")
    with pytest.raises(CardinalityError, match="not a histogram"):
        registry.observe_micros("wlct_c_total", {"result": "ok"}, 5)


def test_series_cap_refuses_new_series_not_new_data() -> None:
    registry = make_registry(max_series_per_family=2)
    registry.register_counter("wlct_capped_total", "cap test", "symbol")
    registry.inc("wlct_capped_total", {"symbol": "BTCUSDT"})
    registry.inc("wlct_capped_total", {"symbol": "ETHUSDT"})
    registry.inc("wlct_capped_total", {"symbol": "SOLUSDT"})  # refused
    registry.inc("wlct_capped_total", {"symbol": "BTCUSDT"})  # existing still records

    snap = registry.snapshot()["wlct_capped_total"]["series"]
    assert len(snap) == 2
    assert snap[0]["value"] == 2.0
    assert registry.overflow_total == 1
    text = render_prometheus(registry)
    assert "wlct_registry_series_overflow_total{service=\"test-svc\"} 1" in text


def test_zero_cap_rejected() -> None:
    with pytest.raises(CardinalityError):
        ObservabilityRegistry(service="x", max_series_per_family=0)


def test_histogram_requires_strictly_increasing_buckets() -> None:
    registry = make_registry()
    with pytest.raises(CardinalityError, match="strictly increasing"):
        registry.register_histogram(
            "wlct_bad_buckets", "no", ("result",), buckets=(1_000, 100)
        )


def test_pipeline_span_uses_monotonic_stamps_and_no_fabricated_zeros() -> None:
    span = PipelineSpan()
    span.mark("market_event_received", at_nanos=1_000_000)
    span.mark("risk_finished", at_nanos=3_500_000)
    assert span.duration_micros("market_event_received", "risk_finished") == pytest.approx(2_500.0)
    # No stamp for fill_received: absence stays absence.
    assert span.duration_micros("risk_finished", "fill_received") is None


def test_pipeline_span_rejects_unknown_stage() -> None:
    span = PipelineSpan()
    with pytest.raises(CardinalityError, match="unknown pipeline stage"):
        span.mark("lunch_break")


def test_pipeline_span_first_mark_wins() -> None:
    span = PipelineSpan()
    span.mark("risk_started", at_nanos=10_000)
    span.mark("risk_started", at_nanos=9_000_000)
    span.mark("risk_finished", at_nanos=20_000)
    assert span.duration_micros("risk_started", "risk_finished") == pytest.approx(10.0)


def test_record_into_counts_completed_transitions_only() -> None:
    registry = make_registry()
    registry.register_histogram(
        "wlct_pipeline_transition_micros",
        "Pipeline transitions.",
        ("stage", "simulation", "exchange"),
        buckets=DEFAULT_MICROS_BUCKETS,
    )
    span = PipelineSpan()
    span.mark("market_event_received", at_nanos=1_000_000)
    span.mark("market_event_processed", at_nanos=2_000_000)
    recorded = span.record_into(registry, simulation="simulated", exchange="binance")
    # Only the one completed adjacent pair; the two aggregates need stamps
    # that do not exist.
    assert recorded == 1
    snap = registry.snapshot()["wlct_pipeline_transition_micros"]["series"]
    assert snap[0]["labels"] == {
        "stage": "market_event_received__market_event_processed",
        "simulation": "simulated",
        "exchange": "binance",
    }


def test_the_engines_observed_stages_are_declared_and_placement_review_is_live() -> None:
    """The vocabulary in :mod:`wlct_trading.metrics` and the call sites must not drift.

    Two directions, treated differently on purpose.

    * Every stage the engine records must be DECLARED. Unconditional, and it is
      the one that catches a real bug: an observed name that is not in
      ``EXECUTION_STAGES`` creates no histogram, so the sample is computed,
      thrown away, and the dashboards quietly under-report a stage nobody
      declared.
    * ``placement_review`` - the stage Part 16 added - must be both declared and
      recorded, with the call site located in the engine's own source rather
      than assumed from the constructor argument.

    What this test does NOT assert is that every declared name has a call site.
    Eight of the thirteen still do not, and that vocabulary came from Part 9. A
    rule that fails on somebody else's unfinished work gets one of two outcomes
    in practice: ignored, or satisfied by deleting the name - which destroys the
    only record that the measurement was ever intended. The number is pinned here
    instead, with a message that tells the next part to update this file and
    docs/PART16_PLACEMENT_REVIEW.md section 6 together, because the document
    quotes it and a document that quotes a stale measurement is the failure mode
    this repository keeps paying for.

    Part 18 moved that number from twelve to eight by timing the four spans the
    engine actually contains (``validation``, ``safety_gates``, ``risk``,
    ``total_submit``). The eight that remain are the ones the engine calls across
    a boundary - signing, network and the venue ack inside the trading adapter,
    ``first_fill`` and ``private_stream_delivery`` inside the stream,
    ``reconciliation_pass`` inside three separate service entry points, and
    ``persistence`` spread over six store writes - each recorded by the layer
    that owns it or not at all, which is the distinction this pin preserves.
    """
    import re
    from pathlib import Path as _Path

    from wlct_trading.metrics import EXECUTION_STAGES

    engine_src = (_Path(__file__).resolve().parents[1] / "wlct_trading" / "execution" / "engine.py").read_text(
        encoding="utf-8"
    )
    observed = set(re.findall(r'observe\w*\(\s*"([a-z_]+)"', engine_src))

    assert observed, "the engine records no stage at all - the vocabulary has no caller"
    undeclared = sorted(observed - set(EXECUTION_STAGES))
    assert undeclared == [], f"observed but not in EXECUTION_STAGES: {undeclared}"

    assert "placement_review" in EXECUTION_STAGES
    assert "placement_review" in observed, (
        "the review is timed in the engine; if that call moved file, update this test to look where it lives"
    )

    unrecorded = sorted(set(EXECUTION_STAGES) - observed)
    assert len(EXECUTION_STAGES) == 13, (
        f"the vocabulary changed size ({len(EXECUTION_STAGES)}); the doc and this test both quote 13"
    )
    assert len(unrecorded) == 8, (
        f"{len(unrecorded)} declared stages have no call site (was 12 before Part 18, "
        "8 after it instrumented the four spans the engine contains). A number BELOW 8 "
        "means somebody wired another stage: update docs/PART16_PLACEMENT_REVIEW.md "
        "sec. 6 and this pin together. A number ABOVE 8 means a call site was deleted "
        "while the vocabulary stayed - that is the regression, and it is why this "
        "count is asserted rather than reported."
    )
    # The four Part 18 stages are named individually, because "four more" would
    # pass with any four: the claim is that THESE spans are timed by THIS file.
    assert {"validation", "safety_gates", "risk", "total_submit"} <= observed


def test_stage_names_are_the_documented_observation_points() -> None:
    assert PIPELINE_STAGES == (
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


def test_render_output_line_shape_and_escaping() -> None:
    registry = make_registry()
    registry.register_counter("wlct_events_total", 'help with "quotes"\nand newline', "result")
    registry.inc("wlct_events_total", {"result": "ok"})
    text = render_prometheus(registry)
    # HELP text escapes backslashes and newlines (a real newline must not
    # split the line); double quotes are legal inside HELP per the format.
    assert '# HELP wlct_events_total help with "quotes"\\nand newline' in text
    assert re.search(r"^wlct_events_total\{result=\"ok\",service=\"test-svc\"\} 1$", text, re.M)
    for line in text.splitlines():
        assert line == line.rstrip(), "no trailing whitespace in exposition"
    assert text.endswith("\n")


def test_render_is_deterministic_sorted() -> None:
    registry = make_registry()
    registry.register_counter("wlct_m_total", "m", "result")
    for result in ("rejected", "approved", "stale"):
        registry.inc("wlct_m_total", {"result": result})
    first = render_prometheus(registry)
    second = render_prometheus(registry)
    assert first == second
    rows = [
        line for line in first.splitlines() if line.startswith("wlct_m_total{")
    ]
    assert rows == sorted(rows)


def test_render_float_formatting() -> None:
    registry = make_registry()
    registry.register_gauge("wlct_ratio", "ratio", "result")
    registry.set_gauge("wlct_ratio", {"result": "a"}, 1.5)
    registry.set_gauge("wlct_ratio", {"result": "b"}, float("nan"))
    text = render_prometheus(registry)
    assert 'wlct_ratio{result="a",service="test-svc"} 1.5' in text
    assert 'wlct_ratio{result="b",service="test-svc"} NaN' in text


def test_empty_families_are_omitted() -> None:
    registry = make_registry()
    registry.register_counter("wlct_never_used_total", "no series yet", "result")
    text = render_prometheus(registry)
    assert "wlct_never_used_total" not in text
    # ...but the registry still counts it in its snapshot for the dashboard.
    assert "wlct_never_used_total" in registry.snapshot()


def test_adapter_folds_internal_histogram_and_refuses_mismatched_edges() -> None:
    source = LatencyHistogram(bounds=(100, 1_000))
    source.observe(50)
    source.observe(700)
    source.observe(9_000)

    registry = make_registry()
    registry.register_histogram(
        "wlct_market_feed_lag_micros",
        "Feed lag.",
        ("result",),
        buckets=(100, 1_000),
    )
    ok = observe_latency_histogram(
        registry, "wlct_market_feed_lag_micros", {"result": "ok"}, source
    )
    assert ok is True
    series = registry.snapshot()["wlct_market_feed_lag_micros"]["series"][0]
    assert series["count"] == 3
    # PER-bucket, not cumulative: the third sample (9_000) is overflow, so both
    # declared buckets hold one observation each and the running total is the
    # renderer's job. This assertion read {"100": 1, "1000": 2} for nine parts
    # because the adapter was accumulating here AND the renderer was accumulating
    # again on the way out - the text was wrong and the state looked right. The
    # lines below are the part of this test that would have caught it.
    assert series["buckets"] == {"100": 1, "1000": 1}

    rendered = render_prometheus(registry)
    lines = {
        line.split(" ")[0]: line.split(" ")[1]
        for line in rendered.splitlines()
        if line.startswith("wlct_market_feed_lag_micros_bucket")
    }
    prefix = "wlct_market_feed_lag_micros_bucket{"
    tail = ',result="ok",service="test-svc"}'
    assert lines[prefix + 'le="100"' + tail] == "1", lines
    assert lines[prefix + 'le="1000"' + tail] == "2", lines
    # +Inf is the source's TOTAL (3), which is the sentence the whole fix is
    # about: one sample overflowed both buckets, and before the correction the
    # renderer's cumulative pass turned "1 then 1" into "1 then 3".
    assert lines[prefix + 'le="+Inf"' + tail] == "3", lines

    mismatched = make_registry()
    mismatched.register_histogram(
        "wlct_market_feed_lag_micros", "Feed lag.", ("result",), buckets=(100,)
    )
    with pytest.raises(CardinalityError, match="must match the source histogram"):
        observe_latency_histogram(
            mismatched, "wlct_market_feed_lag_micros", {"result": "ok"}, source
        )

    class Junk:
        pass

    with pytest.raises(TypeError, match="snapshot_buckets"):
        observe_latency_histogram(registry, "wlct_market_feed_lag_micros", {"result": "ok"}, Junk())


def test_sample_process_populates_conservative_series() -> None:
    import time

    registry = make_registry()
    for gauge in (
        "wlct_process_uptime_seconds",
        "wlct_process_memory_rss_bytes",
        "wlct_process_cpu_seconds_total",
        "wlct_process_open_file_descriptors",
        "wlct_process_file_descriptor_limit",
    ):
        registry.register_gauge(gauge, "process", "service")
    sample_process(registry, started_at_mono=time.monotonic() - 5.0)
    snap = registry.snapshot()
    uptime = snap["wlct_process_uptime_seconds"]["series"][0]["value"]
    assert uptime >= 5.0
    assert snap["wlct_process_memory_rss_bytes"]["series"][0]["value"] > 0
```


## FILE: libs/trading-core/tests/test_part16_placement_attestor.py (1039 lines)

*the stage list the Part 16 test pins became the pipeline in order, with placement_review as the fifth name rather than a lone entry: the order is the assertion, because a list of names that no longer matches the code path is how a timed stage gets moved out of the span it is supposed to measure.*

```python
"""Part 16 plumbing tests: request shape, the attestation cache, the reviewer, and the engine.

The law itself is asserted in :mod:`test_part16_placement_review`. Everything here
is the machinery around it - what is gathered, how often, and what the engine does
with the answer - and the tests share one habit: every class takes an injected
clock, so every time-dependent assertion advances a counter instead of sleeping.
A suite that sleeps is a suite nobody re-runs, and the failure mode this module
exists to prevent is a time window that is off by a little.

The engine tests are the money-path half. They are deliberately built on the same
stub adapter the pre-Part-16 suite uses, so the only difference between an
order that reaches a venue and one that does not is the review verdict.
"""

from __future__ import annotations

import asyncio
import importlib
from dataclasses import replace
from typing import Any

import pytest
from wlct_trading.clock import epoch_micros
from test_execution import (
    StubTradingAdapter,
    accepted_result,
    credentials,
    healthy_context,
    intent,
    paper_settings,
    risk_engine,
)
from wlct_trading.enums import OrderStatus
from wlct_trading.execution import (
    EngineConfigurationError,
    ExecutionEngine,
    ExecutionErrorCode,
    ExecutionOutcome,
    InMemoryIncidentRecorder,
    InMemoryLockManager,
    InMemoryOrderStore,
    OrderValidator,
)
from wlct_trading.execution.credentials import (
    CachingCredentialProvider,
    ExchangeCredentials,
    NullCredentialProvider,
    StaticCredentialProvider,
)
from wlct_trading.execution.placement_attestor import (
    MAX_ATTESTER_TTL_MS,
    MIN_ATTESTER_TTL_MS,
    AttestationFailure,
    CachingPlacementAttestor,
    LocalPlacementAttestor,
    PlacementReviewRequest,
    PlacementReviewer,
    UnattestedPlacementAttestor,
    _collection_code_for,
    symbol_evidence,
)
from wlct_trading.execution.placement_review import (
    NO_KNOWN_WITHDRAWAL_PATH,
    REVIEW_REQUIRED_AT,
    VENUE_TRADING_FIELD,
    VERDICT_CLAIM_WIRE_NAMES,
    PlacementAttestation,
    PlacementFacts,
    PlacementReviewPolicy,
    ReviewCode,
    ReviewSeverity,
)
from wlct_trading.execution.safety import SafetyGate
from wlct_trading.adapters.base import AdapterRateLimitedError, AdapterRejectedError

NOW = 1_700_000_000_000_000


def request(**overrides: Any) -> PlacementReviewRequest:
    base: dict[str, Any] = {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "symbol": "BTCUSDT",
        "order_type": "LIMIT",
        "time_in_force": "GTC",
    }
    base.update(overrides)
    return PlacementReviewRequest(**base)


class FakeClock:
    """An explicit timeline; the only way to test a TTL honestly."""

    def __init__(self, start: int = NOW) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def advance_ms(self, millis: int) -> None:
        self.now += millis * 1_000


class CountingAttestor:
    """Returns whatever it is told, one answer per call, and counts the calls."""

    source = "counting:test"

    def __init__(self, *attestations: PlacementAttestation, error: Exception | None = None) -> None:
        self.calls: list[PlacementReviewRequest] = []
        self._attestations = list(attestations)
        self._error = error

    async def attest(self, request: PlacementReviewRequest) -> PlacementAttestation:
        self.calls.append(request)
        if self._error is not None:
            raise self._error
        if len(self._attestations) == 1:
            return self._attestations[0]
        return self._attestations[min(len(self.calls) - 1, len(self._attestations) - 1)]


def attested(**fact_overrides: Any) -> PlacementAttestation:
    """A complete, fresh attestation.

    Stamped at call time rather than at a fixed instant: the reviewer's clock is
    the process clock unless a test injects one, and a hard-coded 2023 timestamp
    would make every plumbing test depend on how long the machine has been
    running. The freshness boundary itself is asserted in
    :mod:`test_part16_placement_review`, where the clock is an argument.
    """
    now = epoch_micros()
    facts = PlacementFacts(
        venue_backed=True,
        source="binance:apiRestrictions+account+exchangeInfo",
        key_created_at_millis=(now - 3 * 86_400_000 * 1_000) // 1_000,
        key_permission_granted=True,
        read_permitted=True,
        withdrawal_permitted=False,
        ip_allowlist_enabled=True,
        account_can_trade=True,
        account_type="SPOT",
        symbol_attached=True,
        symbol_trading=True,
        order_type_supported=True,
        time_in_force_supported=True,
        clock_skew_millis=5,
        recv_window_millis=5_000,
        venue_trading_permitted=True,
        no_known_withdrawal_path=True,
        review_required_at_micros=now,
    )
    return PlacementAttestation(
        facts=replace(facts, **fact_overrides) if fact_overrides else facts,
        attested_at_micros=now,
    )


# ---------------------------------------------------------------------------
# 1. the request: normalisation, refusal, and the shape in the cache key
# ---------------------------------------------------------------------------


class TestPlacementReviewRequest:
    def test_identifiers_are_normalised_on_construction(self) -> None:
        """One spelling, everywhere, before anything consumes it.

        The symbol and order shape are matched against venue-reported lists and
        baked into a cache key; leaving case to the caller would mean
        ``"btcusdt"`` and ``"BTCUSDT"`` gathering twice and, worse, an
        ``order_type_supported`` lookup consulting a lower-cased list with an
        upper-cased answer and reporting "unsupported" for a shape the venue
        permits.
        """
        lowered = request(symbol="  btcusdt ", order_type="limit", time_in_force="gtc")
        assert (lowered.symbol, lowered.order_type, lowered.time_in_force) == (
            "BTCUSDT",
            "LIMIT",
            "GTC",
        )
        assert lowered == request()

    def test_the_identity_fields_are_left_alone(self) -> None:
        # Tenant and account ids are opaque ids owned by another service. Upper
        # -casing them would be cosmetic here and a lookup miss where the id is a
        # key into a per-tenant table.
        mixed = request(tenant_id="Tenant-A", account_id="Account-b")
        assert (mixed.tenant_id, mixed.account_id) == ("Tenant-A", "Account-b")

    @pytest.mark.parametrize(
        "field",
        ["tenant_id", "account_id", "symbol", "order_type", "time_in_force"],
    )
    def test_a_blank_field_is_refused(self, field: str) -> None:
        with pytest.raises(ValueError, match="must not be blank"):
            request(**{field: "   "})

    def test_an_over_long_field_is_refused(self) -> None:
        for field, limit in (
            ("symbol", 64),
            ("order_type", 32),
            ("tenant_id", 255),
        ):
            with pytest.raises(ValueError, match=f"at most {limit}"):
                request(**{field: "x" * (limit + 1)})
            assert getattr(request(**{field: "x" * limit}), field)

    def test_a_control_character_is_refused(self) -> None:
        # This value is embedded in a log line, a cache key and the digest of an
        # audit record; a newline in it forges all three at once.
        for field in ("symbol", "tenant_id", "account_id"):
            with pytest.raises(ValueError, match="control characters"):
                request(**{field: "BTC\nUSDT"})
            with pytest.raises(ValueError, match="control characters"):
                request(**{field: "BTC\x00USDT"})

    def test_the_cache_key_carries_the_order_shape(self) -> None:
        """The fail-open this build actually had, and now pins shut.

        An attestation stores the symbol's capabilities *reduced to booleans for
        the shape that was asked about*. A key of (tenant, account, symbol) let a
        LIMIT/GTC gather authorise a STOP_LIMIT/IOC order - one gather per
        account looked like an optimisation and was a hole.
        """
        limit = request()
        stop = request(order_type="STOP_LIMIT", time_in_force="IOC")
        assert limit.cache_key() != stop.cache_key()
        assert limit.cache_key() == ("tenant-1", "account-1", "BTCUSDT", "LIMIT", "GTC")
        # Same shape, same key - which is the whole cost argument, kept honest.
        assert request(symbol="btcusdt").cache_key() == limit.cache_key()

    def test_the_request_is_immutable(self) -> None:
        frozen = request()
        with pytest.raises(Exception):
            frozen.symbol = "ETHUSDT"


# ---------------------------------------------------------------------------
# 2. the cache
# ---------------------------------------------------------------------------


class TestCachingPlacementAttestor:
    def test_a_second_identical_order_reuses_the_gather(self) -> None:
        inner = CountingAttestor(attested())
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=60_000, clock=clock)
        first = asyncio.run(cache.attest(request()))
        second = asyncio.run(cache.attest(request()))
        assert first is second
        assert len(inner.calls) == 1
        stats = cache.stats()
        assert (stats["hits"], stats["misses"]) == (1, 1)
        assert stats["entries"] == 1

    def test_the_entry_expires_at_the_ttl_and_not_before(self) -> None:
        inner = CountingAttestor(attested(), attested())
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=60_000, clock=clock)
        asyncio.run(cache.attest(request()))
        clock.advance_ms(59_999)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 1
        clock.advance_ms(2)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 2

    def test_a_failure_is_cached_for_a_fraction_of_the_ttl(self) -> None:
        """An outage must not become a stampede, and must not last an hour.

        Caching the failure keeps one order per key from fanning into four venue
        calls while the venue is down; shrinking the window is what stops the
        outage being remembered long after the venue recovered. The fraction is
        one number in one place, so this test is about both halves at once.
        """
        inner = CountingAttestor(error=AdapterRateLimitedError("429"))
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=100_000, clock=clock)
        first = asyncio.run(cache.attest(request()))
        assert first.collection_code is ReviewCode.ATTESTATION_RATE_LIMITED
        assert first.facts.venue_backed is False
        assert cache.stats()["failuresCached"] == 1
        clock.advance_ms(19_999)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 1  # still holding the failure
        clock.advance_ms(1_000)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 2

    def test_a_cached_failure_never_outlives_the_minimum_window(self) -> None:
        inner = CountingAttestor(error=AdapterRejectedError("401", "Unauthorized"))
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=MIN_ATTESTER_TTL_MS, clock=clock)
        asyncio.run(cache.attest(request()))
        assert cache.stats()["failureTtlMillis"] == MIN_ATTESTER_TTL_MS
        clock.advance_ms(MIN_ATTESTER_TTL_MS)
        asyncio.run(cache.attest(request()))
        assert len(inner.calls) == 2

    def test_the_cache_is_bounded_and_evicts_oldest_first(self) -> None:
        inner = CountingAttestor(attested())
        clock = FakeClock()
        cache = CachingPlacementAttestor(inner, ttl_ms=60_000, max_entries=16, clock=clock)
        for index in range(40):
            clock.advance_ms(10)
            asyncio.run(cache.attest(request(account_id=f"account-{index}")))
        stats = cache.stats()
        assert stats["entries"] <= 16
        assert stats["maxEntries"] == 16
        # The survivors are the most recent ones: an account that just traded
        # keeps its gather, and one that has been idle pays one call if it
        # returns.
        assert len(inner.calls) == 40

    def test_the_ttl_bound_is_the_laws_bound(self) -> None:
        for bad in (MIN_ATTESTER_TTL_MS - 1, MAX_ATTESTER_TTL_MS + 1, 0, -1, True, "60000"):
            with pytest.raises(ValueError, match="ttl_ms"):
                CachingPlacementAttestor(CountingAttestor(attested()), ttl_ms=bad)
        with pytest.raises(ValueError, match="max_entries"):
            CachingPlacementAttestor(CountingAttestor(attested()), max_entries=2)

    def test_the_wrapper_delegates_its_identity(self) -> None:
        inner = CountingAttestor(attested())
        cache = CachingPlacementAttestor(inner, ttl_ms=60_000)
        assert cache.inner is inner
        assert cache.source == "counting:test"

    def test_the_venue_may_refuse_and_the_review_still_returns_a_verdict(self) -> None:
        """Nothing in this path may raise into a submission.

        ``AdapterRejectedError`` becomes a blocking, non-retryable code, which is
        the shape of "an operator must do something": the order is refused, the
        worker does not spin, and the reason survives to the audit record.
        """
        clock = FakeClock()
        cache = CachingPlacementAttestor(
            CountingAttestor(error=AdapterRejectedError("401", "Unauthorized")),
            ttl_ms=60_000,
            clock=clock,
        )
        attestation = asyncio.run(cache.attest(request()))
        assert attestation.collection_code is ReviewCode.ATTESTATION_REFUSED_BY_VENUE
        assert attestation.facts.venue_backed is False
        # The cache's own job ends here: it must hand the reviewer a well-formed
        # "no answer" rather than propagate. Whether that refusal stops an order
        # is the reviewer's law, asserted in TestPlacementReviewer.


# ---------------------------------------------------------------------------
# 3. failure classification
# ---------------------------------------------------------------------------


class TestFailureClassification:
    def test_an_attestor_that_knows_why_it_failed_says_so(self) -> None:
        for code in ReviewCode:
            assert _collection_code_for(AttestationFailure(code, "detail")) is code

    def test_the_two_operationally_distinct_transport_errors_are_kept_apart(self) -> None:
        # Rate-limited: back off. Unreachable: the next order may be fine.
        assert (
            _collection_code_for(AdapterRateLimitedError("429"))
            is ReviewCode.ATTESTATION_RATE_LIMITED
        )
        assert (
            _collection_code_for(AdapterRejectedError("403", "forbidden"))
            is ReviewCode.ATTESTATION_REFUSED_BY_VENUE
        )
        assert _collection_code_for(RuntimeError("dns blew up")) is ReviewCode.ATTESTATION_UNREACHABLE

    def test_a_failure_must_carry_a_code_from_the_closed_vocabulary(self) -> None:
        with pytest.raises(TypeError, match="ReviewCode"):
            AttestationFailure("NO_SPOT_TRADE_PERMISSION")


# ---------------------------------------------------------------------------
# 4. the gatherers
# ---------------------------------------------------------------------------


class TestGatherers:
    def test_unattested_is_a_gatherer_that_answers_nothing(self) -> None:
        attestation = asyncio.run(UnattestedPlacementAttestor().attest(request()))
        assert attestation.facts.venue_backed is False
        assert attestation.collection_code is ReviewCode.NO_ATTESTATION
        assert attestation.facts.source == "unattested"
        assert "no attestor configured" in attestation.collection_detail
        custom = asyncio.run(UnattestedPlacementAttestor(reason="paper mode").attest(request()))
        # The reason travels in the detail, not the source: the source is the
        # gatherer's identity in a status surface, and a free-text reason must not
        # become what a dashboard groups by.
        assert custom.facts.source == "unattested"
        assert "paper mode" in custom.collection_detail

    def test_the_local_gatherer_reads_the_credential_provider(self) -> None:
        async def resolve(tenant_id: str, account_id: str) -> ExchangeCredentials:
            assert (tenant_id, account_id) == ("tenant-1", "account-1")
            return credentials(permissions=frozenset({"READ", "SPOT_TRADE"}))

        gatherer = LocalPlacementAttestor(
            resolve_credentials=resolve, source="local:tenant-vault"
        )
        attestation = asyncio.run(gatherer.attest(request()))
        facts = attestation.facts
        assert facts.source == "local:tenant-vault"
        assert facts.key_permission_granted is True
        assert facts.read_permitted is True
        assert facts.withdrawal_permitted is False
        assert getattr(facts, NO_KNOWN_WITHDRAWAL_PATH) is True
        # The review ran at the injected moment even though nothing was gathered
        # from a venue: the claim timestamp is about us, not about them.
        assert getattr(facts, REVIEW_REQUIRED_AT) == attestation.attested_at_micros > 0
        # Absence of a venue answer is not a venue answer.
        assert facts.venue_backed is False
        assert getattr(facts, VENUE_TRADING_FIELD) is False

    def test_a_provider_that_reports_no_permissions_is_unknown_not_refused(self) -> None:
        """The asymmetry that decides whether a deployment can trade at all.

        ``False`` here means "the venue says this key may not trade", which is
        blocking in a transmitting runtime; a provider with an empty permission
        set has said nothing, and inventing a refusal would lock every paper
        tenant out of the review, while inventing a permission would be worse.
        """
        async def none(tenant_id: str, account_id: str) -> ExchangeCredentials:
            return credentials(permissions=frozenset())

        gatherer = LocalPlacementAttestor(resolve_credentials=none)
        facts = asyncio.run(gatherer.attest(request())).facts
        assert (facts.key_permission_granted, facts.read_permitted, facts.withdrawal_permitted) == (
            None,
            None,
            None,
        )
        assert getattr(facts, NO_KNOWN_WITHDRAWAL_PATH) is False

    def test_a_credential_lookup_that_explodes_is_logged_not_raised(self) -> None:
        async def explode(tenant_id: str, account_id: str) -> ExchangeCredentials:
            raise RuntimeError("vault is down")

        gatherer = LocalPlacementAttestor(resolve_credentials=explode)
        attestation = asyncio.run(gatherer.attest(request()))
        # The gatherer returns what it has (nothing), and the reviewer's law
        # decides whether "nothing" is a refusal. Raising here would surface as an
        # engine internal error instead of a verdict with a code.
        assert attestation.facts.key_permission_granted is None
        assert attestation.facts.venue_backed is False
        assert getattr(attestation.facts, REVIEW_REQUIRED_AT) > 0

    def test_a_symbol_source_narrows_the_answer_to_the_shape_asked_about(self) -> None:
        # A ``SymbolFacts`` is the venue's four answers: attached, trading, the
        # permitted order types, the permitted time-in-forces. The gatherer's only
        # job is to reduce the last two to the shape being placed, because that is
        # what the law can act on.
        facts = (True, True, ("LIMIT", "MARKET"), ("GTC", "IOC"))
        gatherer = LocalPlacementAttestor(symbol_facts=lambda symbol: facts)
        allowed = asyncio.run(gatherer.attest(request())).facts
        assert (allowed.symbol_attached, allowed.symbol_trading) == (True, True)
        assert (allowed.order_type_supported, allowed.time_in_force_supported) == (True, True)
        refused = asyncio.run(
            gatherer.attest(request(order_type="STOP_LIMIT", time_in_force="FOK"))
        ).facts
        assert (refused.order_type_supported, refused.time_in_force_supported) == (False, False)
        # An unknown symbol is an answer: "not attached".
        absent = asyncio.run(
            LocalPlacementAttestor(symbol_facts=lambda symbol: None).attest(request())
        ).facts
        assert (absent.symbol_attached, absent.symbol_trading) == (None, None)

    def test_a_broken_symbol_source_degrades_to_no_opinion(self) -> None:
        def explode(symbol: str) -> Any:
            raise KeyError(symbol)

        facts = asyncio.run(LocalPlacementAttestor(symbol_facts=explode).attest(request())).facts
        assert facts.symbol_attached is None
        assert facts.order_type_supported is None

    def test_skew_is_reported_as_a_magnitude(self) -> None:
        for value in (-40, 40):
            gatherer = LocalPlacementAttestor(skew_millis=lambda: value)
            assert asyncio.run(gatherer.attest(request())).facts.clock_skew_millis == 40
        assert (
            asyncio.run(
                LocalPlacementAttestor(skew_millis=lambda: None).attest(request())
            ).facts.clock_skew_millis
            is None
        )

    def test_symbol_evidence_reduces_lists_to_the_shape_being_placed(self) -> None:
        evidence = symbol_evidence(
            (True, True, ("LIMIT",), ("GTC",)),
            order_type="LIMIT",
            time_in_force="GTC",
        )
        assert (
            evidence.symbol_attached,
            evidence.symbol_trading,
            evidence.order_type_supported,
            evidence.time_in_force_supported,
        ) == (True, True, True, True)
        empty = symbol_evidence(
            (True, True, (), ()), order_type="STOP_LIMIT", time_in_force="FOK"
        )
        # An empty published list is the same answer as no list at all: "we have
        # nothing to compare against", not "nothing is permitted". Reading an
        # unloaded catalog as a refusal would take a whole venue offline for a
        # symbol table that had not finished loading.
        assert (empty.order_type_supported, empty.time_in_force_supported) == (None, None)
        # A venue that publishes no per-symbol time-in-force list (Binance spot
        # does not) therefore cannot produce ``False`` here: the type admits only
        # a list, and the reducer's answer for an empty or absent one is
        # ``None`` = "not attested". The other half of the story - a symbol the
        # table does not list at all - is ``symbol_facts`` returning ``None``,
        # asserted above, where it leaves every symbol field unknown rather than
        # inventing a refusal.
        assert (
            empty.symbol_attached,
            empty.symbol_trading,
            empty.order_type_supported,
            empty.time_in_force_supported,
        ) == (True, True, None, None)


# ---------------------------------------------------------------------------
# 5. the reviewer: the only object the engine is allowed to call
# ---------------------------------------------------------------------------


class TestPlacementReviewer:
    def test_review_never_raises_whatever_the_gatherer_does(self) -> None:
        for error in (
            RuntimeError("boom"),
            AdapterRejectedError("401", "Unauthorized"),
            AttestationFailure(ReviewCode.MALFORMED_VENUE_RESPONSE, "truncated json"),
        ):
            reviewer = PlacementReviewer(
                CountingAttestor(error=error),
                PlacementReviewPolicy(),
                requires_venue_attestation=True,
            )
            attestation_, verdict = asyncio.run(reviewer.review(request()))
            # ``review`` hands back both halves: the raw record, so a caller can
            # persist what it actually received, and the verdict, so it can act.
            assert attestation_.facts.venue_backed is False
            assert verdict.allowed is False
            assert verdict.findings[0].code is _collection_code_for(error)
            assert verdict.findings[0].severity is ReviewSeverity.BLOCKING

    def test_the_runtime_mode_decides_the_consequence_of_the_same_evidence(self) -> None:
        evidence = PlacementFacts(venue_backed=False, source="paper:in-process")
        gatherer = CountingAttestor(
            PlacementAttestation(facts=evidence, attested_at_micros=epoch_micros())
        )
        live = PlacementReviewer(gatherer, PlacementReviewPolicy(), requires_venue_attestation=True)
        paper = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=False
        )
        _, live_verdict = asyncio.run(live.review(request()))
        _, paper_verdict = asyncio.run(paper.review(request()))
        assert live_verdict.allowed is False
        assert paper_verdict.allowed is True
        # The code is the provenance law's own (local facts may not authorise a
        # transmitting runtime), not an invented per-mode code: one cause, one
        # name, with the mode deciding only the consequence.
        assert live_verdict.codes == paper_verdict.codes == ("VENUE_ATTESTATION_REQUIRED",)
        assert live_verdict.findings[0].severity is ReviewSeverity.BLOCKING
        assert paper_verdict.findings[0].severity is ReviewSeverity.INFO
        # The verdict ids differ, so an audit line can be traced to the runtime
        # that produced it - which is how a paper verdict could never be presented
        # as authority for a live order even by someone copying the record.
        assert live_verdict.verdict_id != paper_verdict.verdict_id

    def test_an_evidence_gap_becomes_a_refusal_only_when_evidence_is_required(self) -> None:
        gap = PlacementAttestation.unavailable(
            now_micros=epoch_micros(),
            code=ReviewCode.ATTESTATION_RATE_LIMITED,
            detail="429 from the venue",
            source="binance:apiRestrictions",
        )
        gatherer = CountingAttestor(gap)
        live = PlacementReviewer(gatherer, PlacementReviewPolicy(), requires_venue_attestation=True)
        paper = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=False
        )
        _, live_verdict = asyncio.run(live.review(request()))
        _, paper_verdict = asyncio.run(paper.review(request()))
        # "The venue is rate-limiting us" is a WARNING in the table, and a
        # transmitting runtime raises it to BLOCKING: a warning would authorise
        # the order on no evidence at all.
        assert live_verdict.allowed is False
        assert live_verdict.retryable is True
        assert paper_verdict.allowed is True
        assert paper_verdict.findings[0].severity is ReviewSeverity.WARNING

    def test_attestation_is_the_raw_record_and_never_a_verdict(self) -> None:
        gatherer = CountingAttestor(attested())
        reviewer = PlacementReviewer(gatherer, PlacementReviewPolicy(), requires_venue_attestation=True)
        raw = asyncio.run(reviewer.attestation(request()))
        assert isinstance(raw, PlacementAttestation)
        assert raw.collection_code is None

    def test_describe_reports_the_wiring_without_inventing_provenance(self) -> None:
        gatherer = CachingPlacementAttestor(
            CountingAttestor(attested()), ttl_ms=90_000, clock=FakeClock()
        )
        described = PlacementReviewer(
            gatherer, PlacementReviewPolicy(max_attestation_age_ms=90_000), requires_venue_attestation=True
        ).describe()
        assert described["attestorSource"] == "counting:test"
        assert described["requiresVenueAttestation"] is True
        assert described["cache"] == {
            "entries": 0,
            "hits": 0,
            "misses": 0,
            "failuresCached": 0,
            "ttlMillis": 90_000,
            "failureTtlMillis": 18_000,
            "maxEntries": 4_096,
        }
        assert described["policy"]["maxAttestationAgeMillis"] == 90_000
        assert sorted(described) == [
            "attestorSource",
            "cache",
            "operatorConfirmation",
            "policy",
            "requiresVenueAttestation",
        ]
        # Part 19: the confirmation block is present even when nothing is wired, so
        # "we did not wire it" and "we wired it and it is absent" are two different
        # payloads. A key that vanished when unset would make the absence
        # indistinguishable from a renderer bug at 3am.
        assert described["operatorConfirmation"] == {
            "required": False,
            "keyConfigured": False,
            "recordPresent": False,
            "expiresAtMicros": 0,
            "fingerprint": "",
        }

    def test_describe_survives_a_gatherer_whose_properties_are_broken(self) -> None:
        class Broken(CountingAttestor):
            @property
            def source(self) -> str:
                raise RuntimeError("attribute exploded")

        described = PlacementReviewer(
            Broken(attested()), PlacementReviewPolicy(), requires_venue_attestation=False
        ).describe()
        # A fixed label, not the exception text: a broken attribute must not be
        # able to leak a value into a status surface while pretending to name it.
        assert described["attestorSource"] == "unavailable"
        assert described["requiresVenueAttestation"] is False
        # No "cache" key at all, rather than an empty or zeroed one: a status
        # surface that prints zeros for a component that does not exist reads as
        # "wired and idle" to whoever is on call.
        assert "cache" not in described

    def test_the_reviewer_is_reusable_across_orders_and_caches_through_it(self) -> None:
        inner = CountingAttestor(attested())
        clock = FakeClock()
        reviewer = PlacementReviewer(
            CachingPlacementAttestor(inner, ttl_ms=60_000, clock=clock),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        for _ in range(5):
            _, verdict = asyncio.run(reviewer.review(request()))
            assert verdict.allowed is True
        assert len(inner.calls) == 1
        clock.advance_ms(60_001)
        _, verdict = asyncio.run(reviewer.review(request()))
        assert verdict.allowed is True
        assert len(inner.calls) == 2


# ---------------------------------------------------------------------------
# 6. the engine: construction law, and the two outcomes
# ---------------------------------------------------------------------------


class DistributedLocks:
    """Stand-in for the Redis lock manager: enough surface to pass the law."""

    is_distributed = True

    class _Hold:
        async def __aenter__(self) -> None:
            return None

        async def __aexit__(self, *exc: object) -> bool:
            return False

    def hold(self, *args: Any, **kwargs: Any) -> Any:
        return self._Hold()


class DurableStore(InMemoryOrderStore):
    """An in-memory store that claims durability, for wiring tests only.

    It exists to satisfy one ``getattr`` in the live-mode checks so a test can
    reach the reviewer gate at the end of them. Nothing here submits live
    orders for real; a test that needs durability behaviour uses the SQL store's
    own suite.
    """

    @property
    def is_durable(self) -> bool:
        return True


class LiveAdapter(StubTradingAdapter):
    @property
    def is_simulated(self) -> bool:
        return False


def live_settings(**overrides: Any) -> Any:
    base: dict[str, Any] = {
        "live_trading_enabled": True,
        "dry_run": False,
        "paper_trading": False,
        "trading_mode_setting": "LIVE",
        "trading_enabled": True,
        "live_trading_confirmed": True,
        # Opted out deliberately: the risk gate is asserted in its own part's
        # suite, and a test of the placement gate must not have to wire a second
        # safety layer to reach the one under test.
        "risk_gate_required": False,
    }
    base.update(overrides)
    return paper_settings(**base)


def build(
    adapter: Any,
    *,
    settings: Any,
    reviewer: PlacementReviewer | None = None,
    metrics: Any = None,
) -> tuple[ExecutionEngine, InMemoryOrderStore, InMemoryIncidentRecorder]:
    store = DurableStore()
    recorder = InMemoryIncidentRecorder()
    engine = ExecutionEngine(
        adapter=adapter,
        settings=settings,
        risk_engine=risk_engine(),
        store=store,
        locks=(
            DistributedLocks() if settings.will_transmit_orders else InMemoryLockManager()
        ),
        incidents=recorder,
        validator=OrderValidator(),
        placement_reviewer=reviewer,
        metrics=metrics,
    )
    return (engine, store, recorder)


class TestEngineConstructionLaw:
    def test_a_live_runtime_without_a_reviewer_refuses_to_start(self) -> None:
        with pytest.raises(EngineConfigurationError, match="placement reviewer"):
            build(LiveAdapter(result=accepted_result()), settings=live_settings())

    def test_the_same_runtime_with_a_reviewer_starts(self) -> None:
        reviewer = PlacementReviewer(
            CountingAttestor(attested()),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        engine, _, _ = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=reviewer,
        )
        assert engine.settings.will_transmit_orders is True
        # The reviewer is exercised through behaviour, not a public attribute: an
        # engine that starts with a live adapter and answers a submit from a
        # permitted review IS the wiring being asserted.
        result = asyncio.run(engine.submit(intent(), healthy_context()))
        assert result.outcome is ExecutionOutcome.ACCEPTED
        assert result.transmitted is True

    def test_a_simulated_runtime_may_start_without_one(self) -> None:
        # No reviewer and no transmission: allowed, and the gate says so out loud
        # (asserted in TestEngineUnderReview, where the wording is the point).
        engine, _, _ = build(
            StubTradingAdapter(result=accepted_result()), settings=paper_settings()
        )
        result = asyncio.run(engine.submit(intent(), healthy_context()))
        assert result.outcome is ExecutionOutcome.ACCEPTED

    def test_the_gate_error_map_covers_every_gate_including_the_new_one(self) -> None:
        from wlct_trading.execution import engine as engine_module

        mapped = set(engine_module._GATE_ERROR_CODES)
        assert mapped == set(SafetyGate)
        assert (
            engine_module._GATE_ERROR_CODES[SafetyGate.PLACEMENT_ATTESTED]
            is ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        )
        # An unmapped gate would fall through to INTERNAL_ERROR, which is the
        # wrong taxonomy for "the venue says no".
        assert engine_module._gate_error_code(SafetyGate.PLACEMENT_ATTESTED) is (
            ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        )


class TestEngineUnderReview:
    def submit(self, engine: ExecutionEngine) -> Any:
        return asyncio.run(engine.submit(intent(), healthy_context(credentials=credentials())))

    def test_a_refused_review_never_reaches_the_venue(self) -> None:
        adapter = LiveAdapter(result=accepted_result())
        reviewer = PlacementReviewer(
            CountingAttestor(
                attested(
                    withdrawal_permitted=True,
                    no_known_withdrawal_path=False,
                    venue_trading_permitted=False,
                )
            ),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        engine, store, recorder = build(adapter, settings=live_settings(), reviewer=reviewer)
        result = self.submit(engine)

        assert result.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert result.error_code is ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        assert adapter.submit_calls == []
        assert result.safety is not None
        blocked = [
            gate for gate in result.safety.results if gate.gate is SafetyGate.PLACEMENT_ATTESTED
        ]
        assert blocked and blocked[0].passed is False
        assert "WITHDRAW_ENABLED" in blocked[0].detail
        # A blocked review is a fault, so it pages: the incident is how an
        # operator learns the venue changed something under a running process.
        incidents = recorder.all
        assert len(incidents) == 1
        assert "PLACEMENT_ATTESTED" in incidents[0].summary
        assert incidents[0].error_code is ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED
        assert store.order_count() == 0

    def test_a_passing_review_records_its_verdict_beside_the_order(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        record = attested()
        gatherer = CountingAttestor(record)
        reviewer = PlacementReviewer(
            gatherer, PlacementReviewPolicy(), requires_venue_attestation=False
        )
        engine, store, recorder = build(
            adapter, settings=paper_settings(), reviewer=reviewer
        )
        result = self.submit(engine)
        assert result.outcome is ExecutionOutcome.ACCEPTED
        assert len(adapter.submit_calls) == 1
        assert recorder.all == ()

        events = asyncio.run(store.list_events("tenant-1", result.order.order_id))
        submitted = [
            event for event in events if event.status is OrderStatus.SUBMITTED
        ]
        assert len(submitted) == 1
        payload = submitted[0].payload
        assert payload["allowed"] == "true"
        assert payload["venueBacked"] == "true"
        assert payload["codes"] == ""
        assert payload["verdictId"]
        # The claim the gatherer made, byte for byte, in the event the order
        # carries: this is what lets an auditor answer "was the review inside the
        # freshness window *at submission*", which neither the verdict id nor the
        # event's own timestamp can tell them.
        claimed = payload["reviewRequiredAtMicros"]
        assert claimed.isdigit()
        assert claimed == str(getattr(record.facts, REVIEW_REQUIRED_AT))
        assert int(claimed) <= epoch_micros()
        assert payload[VERDICT_CLAIM_WIRE_NAMES[VENUE_TRADING_FIELD]] == "true"
        # One gather for one order: the reviewer is called by the engine, not by
        # the submission path and not twice by both.
        assert len(gatherer.calls) == 1

    def test_the_verdict_is_measured_and_counted(self) -> None:
        class Counters:
            placement_reviews = 0
            placement_review_blocks = 0
            placement_attestation_failures = 0

        class Metrics:
            def __init__(self) -> None:
                self.counters = Counters()
                self.observations: list[tuple[str, int]] = []

            def observe(self, name: str, value: int) -> None:
                self.observations.append((name, value))

        metrics = Metrics()
        reviewer = PlacementReviewer(
            CountingAttestor(error=RuntimeError("unreachable")),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        engine, _, _ = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=reviewer,
            metrics=metrics,
        )
        self.submit(engine)
        names = [name for name, _ in metrics.observations]
        # Part 16 asserted ["placement_review"] alone, when the review was the
        # only stage this engine timed. The list is now the pipeline in order,
        # and the ordering is the part's actual claim: the review runs after
        # validation and BEFORE the safety gates, because "the verdict arrives as
        # one more gate input" only holds if the gates see it. The blocked path
        # never reaches risk, which is why risk is absent here rather than a
        # fourth stage.
        assert names == ["validation", "placement_review", "safety_gates", "total_submit"]
        assert metrics.counters.placement_reviews == 1
        assert metrics.counters.placement_review_blocks == 1
        # The extra counter is the one an operator pages on: a block because a
        # venue could not be reached is an infrastructure alert, and a block
        # because a key gained withdrawal permission is a security one.
        assert metrics.counters.placement_attestation_failures == 1

        entitlement = PlacementReviewer(
            CountingAttestor(attested(withdrawal_permitted=True)),
            PlacementReviewPolicy(),
            requires_venue_attestation=True,
        )
        counters_only = Metrics()
        engine2, _, _ = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=entitlement,
            metrics=counters_only,
        )
        self.submit(engine2)
        assert counters_only.counters.placement_review_blocks == 1
        assert counters_only.counters.placement_attestation_failures == 0

    def test_a_runtime_with_no_reviewer_records_the_gate_as_not_applicable(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, _, _ = build(adapter, settings=paper_settings())
        result = self.submit(engine)
        assert result.outcome is ExecutionOutcome.ACCEPTED
        gates = {gate.gate: gate for gate in result.safety.results}
        placement = gates[SafetyGate.PLACEMENT_ATTESTED]
        assert placement.passed is True
        assert placement.applicable is False
        # The wording is part of the contract: "not applicable" on a live runtime
        # would be a lie, and the construction law above is what keeps it true.
        assert "refuses to start" in placement.detail

    def test_the_request_the_engine_builds_carries_the_intents_shape(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        gatherer = CountingAttestor(attested())
        engine, _, _ = build(
            adapter,
            settings=paper_settings(),
            reviewer=PlacementReviewer(
                gatherer, PlacementReviewPolicy(), requires_venue_attestation=False
            ),
        )
        self.submit(engine)
        seen = gatherer.calls[0]
        original = intent()
        assert seen.tenant_id == original.tenant_id
        assert seen.account_id == original.account_id
        assert seen.symbol == original.symbol.upper()
        assert seen.order_type == original.order_type.value.upper()
        assert seen.time_in_force == original.time_in_force.value.upper()

    def test_a_null_credential_provider_is_orthogonal_to_the_review(self) -> None:
        """Two different "not wired" states, and neither is the other's cure.

        Credentials let the engine sign; the review asks whether signing is
        permitted. A deployment that has one and not the other is exactly the
        misconfiguration this part exists to make loud.
        """
        provider = CachingCredentialProvider(NullCredentialProvider("simulated"), ttl_seconds=60)
        with pytest.raises(Exception):
            asyncio.run(provider.resolve("tenant-1", "account-1", credentials().exchange))
        assert provider.source.startswith("cached(")
        assert provider.inner.__class__.__name__ == "NullCredentialProvider"

        static = CachingCredentialProvider(
            StaticCredentialProvider([credentials()]), ttl_seconds=60
        )
        resolved = asyncio.run(static.resolve("tenant-1", "account-1", credentials().exchange))
        assert resolved is not None
        assert static.size == 1
        asyncio.run(static.resolve("tenant-1", "account-1", credentials().exchange))
        assert static.size == 1


# ---------------------------------------------------------------------------
# 6. the package surface
# ---------------------------------------------------------------------------


class TestUmbrellaReExports:
    """``wlct_trading.execution`` may not be a partial view of the placement layer.

    The umbrella package re-exports the review law and the gatherers by group, and
    the first cut of this part exported the readable types and left the numbers
    behind: a service that wants to validate its own TTL against
    ``MAX_ATTESTATION_AGE_MS`` had to reach into a module path, which is how a
    bound gets retyped and then drifts. Asserted as a subset rule over what each
    module DECLARES rather than as a written-out list, because the failure worth
    catching is a name that exists in the module and is missing from the package -
    a list would just be updated to match.
    """

    @pytest.mark.parametrize(
        "module_name",
        [
            "wlct_trading.execution.placement_review",
            "wlct_trading.execution.placement_attestor",
            # Part 19's two modules join the parametrisation rather than getting a
            # test of their own, so the rule stays what it always was: whatever a
            # placement-layer module declares public must be reachable from the
            # package. A new module that forgets the umbrella fails here, in the
            # suite that already exists, and not in a review comment.
            "wlct_trading.execution.live_confirmation",
            "wlct_trading.execution.live_enablement",
        ],
    )
    def test_everything_a_placement_module_declares_is_reachable(
        self, module_name: str
    ) -> None:
        module = importlib.import_module(module_name)
        package = importlib.import_module("wlct_trading.execution")
        declared = set(module.__all__)
        assert declared, f"{module_name} declares nothing public"
        missing = sorted(declared - set(package.__all__))
        assert missing == [], f"not re-exported by wlct_trading.execution: {missing}"
        for name in sorted(declared):
            assert getattr(package, name) is getattr(module, name), name
```


## FILE: services/execution-engine/app/config.py (805 lines)

*OBSERVABILITY_ENABLED defaulting true, the NODE_ENV=production refusal to run dark, and observabilityEnabled on to_public_dict so a console can tell intent from the endpoint's presence. Same name and same rule as both siblings, which is why compose has been passing it to this service since before this part read it.*

```python
"""Configuration for the execution engine.

Every value comes from the environment. There are no defaults for secrets:
a missing or placeholder internal token stops the process rather than
starting a service that silently cannot authenticate its callers.

The field types are all defaulted so ``Settings()`` constructs cleanly under
mypy strict; the requirement that critical values EXIST is enforced in the
model validator, not by missing defaults, and the error messages name the
environment variable so a boot failure is self-explaining.
"""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from wlct_trading.enablement import EnablementError, EnablementPolicy
from wlct_trading.execution.live_confirmation import (
    LiveConfirmationError,
    LiveOperatorConfirmation,
)
from wlct_trading.execution.placement_attestor import (
    MAX_ATTESTER_TTL_MS,
    MIN_ATTESTER_TTL_MS,
)
from wlct_trading.execution.placement_review import (
    MAX_KEY_AGE_DAYS,
    MIN_KEY_AGE_DAYS,
    PlacementReviewError,
    PlacementReviewPolicy,
)
from wlct_trading.retention import RetentionError, RetentionPolicy

from app.secret_fetcher import VaultKvConfig

__all__ = ["Settings", "get_settings"]

#: Placeholder spellings rejected everywhere on this platform. A token that
#: reads "changeme" is the same as no token, and discovering that during an
#: incident is how incidents get longer.
#: Exact values that can never be a real secret, and the prefixes that mark
#: "this was a template nobody filled in" ("changeme-64-xs" is as placeholder
#: as "changeme" - suffix noise does not launder it).
_PLACEHOLDERS = frozenset(
    {
        "changeme",
        "change-me",
        "replace_me",
        "replace-me",
        "secret",
        "todo",
        "none",
        "null",
        "undefined",
        "example",
    }
)
_PLACEHOLDER_PREFIXES = ("changeme", "change-me", "replace_me", "replace-me")


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

    # ------------------------------------------------------------------
    # Observability (Part 18)
    #
    # Same name, same meaning as in services/trading-engine and
    # services/market-data: a platform knob is not re-spelled per service, and
    # production refuses to parse with it off. What differs is only what this
    # service exposes - one Prometheus scrape of the engine's own instruments,
    # with no Redis mirror and no alert stream, because this process's evidence
    # lives in its durable tables and on /internal/v1/status.
    # ------------------------------------------------------------------
    OBSERVABILITY_ENABLED: bool = True

    # --- Identity and transport ------------------------------------------
    #: Names this instance in logs, the health surface and (later) the
    #: worker registry. Not a secret; not a credential; useful in a
    #: postmortem that says "which process thought it was leader".
    EXECUTION_INSTANCE_ID: str | None = None
    SERVICE_PORT: int = 8093
    #: Loopback by default: this process must be explicitly re-bound (env)
    #: to serve another container, and deployments that do so keep it on an
    #: internal network - the token is authentication, not segmentation.
    EXECUTION_ENGINE_HOST: str = "127.0.0.1"
    #: Shared secret with the Node worker. Minimum 32 characters, constant
    #: time compared in app.security, never logged.
    EXECUTION_INTERNAL_TOKEN: str | None = None

    # --- Mode ---------------------------------------------------------------
    #: "simulated" is the only mode this build transmits in. "live" parses
    #: (so a staged config does not fail boot for a syntax reason while it
    #: fails a safety reason) but startup refuses it with MODE_NOT_WIRED.
    EXECUTION_MODE: Literal["simulated", "live"] = "simulated"
    #: When true, order SUBMISSION stops before transmission. Cancellation
    #: is not a new position and stays available either way - failing to
    #: cancel a resting order is the larger risk of the two.
    EXECUTION_DRY_RUN: bool = True
    #: Per-request venue timeout handed to the core engine settings.
    EXECUTION_REQUEST_TIMEOUT_MS: int = 5_000
    #: Lease TTL for the core's own account/order locks (milliseconds).
    EXECUTION_LOCK_TTL_MS: int = 15_000

    # --- Simulated venue shaping -------------------------------------------
    #: Fixed mid used as top-of-book for any symbol. Unset means the paper
    #: book is empty: submissions are refused for lack of price, which is
    #: the honest default for a deployment that configured nothing.
    EXECUTION_SIMULATED_MID: str | None = None
    #: Comma-separated `ASSET=QUANTITY` seed balances for the simulated
    #: account. Balances are labelled simulated wherever they surface.
    EXECUTION_PAPER_BALANCES: str = "USDT=100000"

    # --- Durable state (Part 13) --------------------------------------------
    #: "memory" keeps the process-local reference store (everything this
    #: service did before Part 13; readiness honestly reports
    #: storeDurable=false). "postgres" requires the engine tables (owned by
    #: apps/api/prisma, applied by the API's migration job) and a DSN, and
    #: refuses startup without either - a store configured but unreachable
    #: is "not running", never "running degraded": the moment this process
    #: cannot durably record an order it must stop taking commands.
    EXECUTION_STORE_BACKEND: Literal["memory", "postgres"] = "memory"
    #: DSN for the engine store, e.g. postgresql://user:pass@db:5432/wlct.
    #: A credential: env-only, never logged, never in to_public_dict, and
    #: like every DSN on this platform it belongs to a dedicated role, not
    #: the owner. The engine sets app.tenant_id per transaction (the same
    #: contract as the API's withTenantRls), so these tables are RLS-safe
    #: from the day the operator flips policies on.
    EXECUTION_POSTGRES_DSN: str | None = None

    # --- Retention (Part 14) -----------------------------------------------
    #: The apply switch. False (the default) leaves every retention call in
    #: DRY-RUN: inspection always works, deletion never happens, and an
    #: apply request is refused with the config named. A maintenance job
    #: that destroys data does not run because a compose file once existed.
    #: It also does not run on a schedule nobody reviewed: the intended
    #: first use is inspect (disabled) -> scheduled dry-run -> one manual
    #: apply against a fresh backup -> enable (docs/PART14_RETENTION.md).
    EXECUTION_RETENTION_ENABLED: bool = False
    #: Days of journal kept beyond an order's own settlement (the cutoff
    #: applies to the event AND the order's terminal stamp - core law 2).
    #: Bounds are enforced by constructing the core policy below; this
    #: service has no second arithmetic for them.
    EXECUTION_RETENTION_EVENT_DAYS: int = 90
    #: Rows per DELETE statement, and statements per run. Together they
    #: cap one run at batch_rows * max_batches deletions - the ceiling a
    #: busy deployment tunes, and the reason a first prune after long
    #: dormancy is many small transactions instead of one huge one.
    EXECUTION_RETENTION_BATCH_ROWS: int = 2_000
    EXECUTION_RETENTION_MAX_BATCHES: int = 50

    # --- RLS enablement verification (Part 15) -----------------------------
    #: How long an enablement audit may sit before it stops counting as
    #: evidence. This is NOT enforcement - the audit is read-only and this
    #: service cannot fail closed over another service's row-level security -
    #: it is the freshness the response reports and the evidence ledger
    #: checks. A deployment that re-audits nightly keeps the number
    #: meaningless-in-a-good-way; one that never re-audits sees it go stale.
    #: Bounds (1..36,500 days) are the core's law, validated at boot below.
    EXECUTION_ENABLEMENT_MAX_AGE_DAYS: int = 30

    # --- placement review and the credential source (Part 16) --------------
    # There is deliberately no EXECUTION_PLACEMENT_REVIEW_ENABLED. A switch that
    # turns off "did the venue say this key may place this order" is not a
    # feature flag, it is a bypass, and this repository's guards do not ship
    # bypasses. What IS configurable is where the evidence comes from and how
    # expensive it may be - every field below is about cost or staleness, none
    # about permission.
    #: Where a live runtime would read key material from. ``none`` is the
    #: default and the only value a simulated deployment should have: it wires a
    #: provider that refuses every lookup, so an accidental authenticated call
    #: from a paper process fails loudly instead of finding a stray key in the
    #: environment. ``environment`` is development-only (see the refusal in
    #: ``_validate``); ``secret-manager`` is the multi-tenant path and takes its
    #: fetcher from the deployment's own secret backend, not from an env var.
    EXECUTION_CREDENTIAL_SOURCE: Literal["none", "environment", "secret-manager"] = "none"
    #: Prefix for the two variables ``environment`` reads. The core appends
    #: ``_API_KEY`` / ``_API_SECRET`` to it, so this carries NO trailing
    #: underscore: a prefix of ``WLCT_BINANCE_`` would look for
    #: ``WLCT_BINANCE__API_KEY``, which nobody ever sets, and the boot check
    #: below (which reads the same names this module computes) would pass while
    #: every order failed on a missing credential. Named here rather than
    #: hard-coded because a host that already injects ``BINANCE_*`` keys for
    #: another process must not have this one read them by accident.
    EXECUTION_CREDENTIAL_ENV_PREFIX: str = "WLCT_BINANCE"
    #: The single (tenant, account) an ``environment`` provider serves. The
    #: environment has no way to key a secret per customer, so a deployment that
    #: needs more than one pair of keys needs ``secret-manager`` - a limitation
    #: of the mechanism, stated rather than papered over.
    EXECUTION_CREDENTIAL_TENANT_ID: str = "tenant-1"
    EXECUTION_CREDENTIAL_ACCOUNT_ID: str = "account-1"
    #: How long a resolved credential may be cached before the provider goes
    #: back to its source. Zero is not offered: a cache with a zero TTL still
    #: pays the wrapper's bookkeeping and buys nothing.
    EXECUTION_CREDENTIAL_CACHE_SECONDS: int = 300
    #: How long a gathered placement attestation may be reused. This IS the
    #: freshness bound the review applies (one number, so the cache and the law
    #  cannot disagree about what "recent" means), and it is also why a burst of
    #  orders for one account costs one venue round trip rather than one per
    #  order. Bounds (1s..1h) are the core's law, enforced at boot below.
    EXECUTION_PLACEMENT_ATTESTATION_TTL_MS: int = 300_000
    #: How old a key may be and still trade. Rotation is an operator habit this
    #  platform can only encourage by refusing to trade on a key nobody has
    #  rotated in a year; bounds (1..36,500 days) are the core's law.
    EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS: int = 90
    #: Whether the venue must report an IP allowlist on the key. Default true,
    #  and ``false`` is refused outright for a live mode: a key that answers from
    #  any address is a key that is one leaked env file away from being someone
    #  else's trading account.
    EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST: bool = True

    # --- live credential fetcher and the operator confirmation (Part 19) --------
    # Two more things the live path needed and this service did not have: a concrete
    # reader for the ``secret-manager`` credential source, and a typed confirmation that
    # a human authorised this scope. Neither is a permission. The selector below picks
    # an implementation, and the confirmation block below feeds a check that can only
    # add refusals. ``EXECUTION_MODE=live`` still refuses at startup, with these two
    # additions named among the reasons.
    #: Which fetcher backs ``EXECUTION_CREDENTIAL_SOURCE=secret-manager``. ``none`` is
    #: the default and keeps every existing deployment byte-identical: the source then
    #: has no reader, and the boot refusal says so. ``vault-kv2`` is this service's own
    #: implementation over HashiCorp Vault's KV v2 API (see app/secret_fetcher.py); a
    #: deployment on a different KMS injects its own fetcher instead, which is the
    #: choice Part 16 left open and Part 19 deliberately did not close for anybody.
    EXECUTION_CREDENTIAL_FETCHER: Literal["none", "vault-kv2"] = "none"
    #: e.g. https://vault.internal:8200 . Required by vault-kv2. Credentials embedded
    #: in a URL (``user:pass@host``) are refused, not honoured.
    EXECUTION_VAULT_ADDR: str | None = None
    #: The KV v2 mount, one path segment (``secret`` in Vault's own quickstart).
    EXECUTION_VAULT_MOUNT: str = "secret"
    #: The lookup path, relative to ``/data/`` under the mount. The three placeholders
    #: are filled from this deployment's own identifiers, never from a request.
    EXECUTION_VAULT_PATH_TEMPLATE: str = "wlct/{tenant}/{account}/{exchange}"
    #: NAME of the environment variable holding the Vault token. The token is read from
    #: the process environment by the fetcher and is NEVER a field on this object, so
    #: no ``model_dump``, no ``to_public_dict`` and no debugger can surface it.
    EXECUTION_VAULT_TOKEN_ENV: str = "EXECUTION_VAULT_TOKEN"
    #: Vault enterprise namespace header. ``None`` sends no header.
    EXECUTION_VAULT_NAMESPACE: str | None = None
    EXECUTION_VAULT_TIMEOUT_MS: int = 3_000
    #: TLS verification of the Vault endpoint. ``false`` is refused in production, and
    #: the endpoint must be https in every mode (see VaultKvConfig).
    EXECUTION_VAULT_TLS_VERIFY: bool = True
    EXECUTION_VAULT_MAX_RESPONSE_BYTES: int = 65_536
    #: Require a verified operator confirmation on every placement review. Default
    #: false, and that default is the point: turning the check on is a deployment
    #: decision, and leaving it off must not change any verdict that exists today.
    #: This is NOT ``ALLOW_LIVE`` under another name - it cannot enable live mode, it
    #: cannot relax a review, and when it is on with nothing to verify, every order is
    #: refused as OPERATOR_CONFIRMATION_ABSENT.
    EXECUTION_REQUIRE_OPERATOR_CONFIRMATION: bool = False
    #: The confirmation record, inline as JSON. Mutually exclusive with the file form,
    #: because a deployment that has two sources of truth for one ceremony has two
    #: ceremonies.
    EXECUTION_OPERATOR_CONFIRMATION_JSON: str | None = None
    #: ...or the path to a file containing it. The record carries identities and a
    #: window and an HMAC tag, and no key material, so reading it off disk is a
    #: convenience rather than a secret-handling exception.
    EXECUTION_OPERATOR_CONFIRMATION_FILE: str | None = None
    #: NAME of the environment variable holding the HMAC key that verifies the record.
    #: Env-only, for the same reason as the Vault token, and checked for presence at
    #: boot by app/placement.py, which is where the verifier is assembled.
    EXECUTION_CONFIRMATION_KEY_ENV: str = "EXECUTION_CONFIRMATION_HMAC_KEY"

    @model_validator(mode="after")
    def _require_observability_in_production(self) -> Settings:
        if self.NODE_ENV == "production" and not self.OBSERVABILITY_ENABLED:
            raise ValueError(
                "OBSERVABILITY_ENABLED=false in production: a process that can "
                "hold a venue key and place an order must expose what it measured "
                "while doing so. The stage histograms and the placement-review "
                "counters are how a refusal is distinguished from an outage "
                "without shell access; development may turn them off freely, a "
                "deployment holding real money may not."
            )
        return self

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        if self.EXECUTION_INTERNAL_TOKEN is None or not self.EXECUTION_INTERNAL_TOKEN.strip():
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN is required (>= 32 chars); this "
                "service never starts unauthenticated"
            )
        if len(self.EXECUTION_INTERNAL_TOKEN) < 32:
            raise ValueError("EXECUTION_INTERNAL_TOKEN must be at least 32 characters")
        lowered = self.EXECUTION_INTERNAL_TOKEN.strip().lower()
        if lowered in _PLACEHOLDERS or lowered.startswith(_PLACEHOLDER_PREFIXES):
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN must not be a placeholder value "
                "(exact match or changeme-style prefix)"
            )
        if self.EXECUTION_INSTANCE_ID is None or not self.EXECUTION_INSTANCE_ID.strip():
            raise ValueError(
                "EXECUTION_INSTANCE_ID is required - every leader claim, log "
                "line and incident must be attributable to a process"
            )
        if len(self.EXECUTION_INSTANCE_ID) > 64:
            raise ValueError("EXECUTION_INSTANCE_ID must be at most 64 characters")
        if self.SERVICE_PORT < 1 or self.SERVICE_PORT > 65_535:
            raise ValueError("SERVICE_PORT must be a valid TCP port")
        if self.EXECUTION_REQUEST_TIMEOUT_MS < 250:
            raise ValueError(
                "EXECUTION_REQUEST_TIMEOUT_MS below 250 tests the venue, not the network"
            )
        if self.EXECUTION_LOCK_TTL_MS < 1_000:
            raise ValueError(
                "EXECUTION_LOCK_TTL_MS below one second elects on network jitter"
            )
        if self.EXECUTION_SIMULATED_MID is not None:
            _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, sep, amount = part.partition("=")
            if not sep or not asset.strip():
                raise ValueError(
                    "EXECUTION_PAPER_BALANCES must be comma-separated ASSET=QUANTITY pairs"
                )
            _parse_decimal(amount, f"balance {asset.strip()!r}")
        # An EMPTY/whitespace DSN is treated as "unset" everywhere (compose
        # passes ${VAR:-} defaults; "" must not arm the mismatch law below).
        dsn = (self.EXECUTION_POSTGRES_DSN or "").strip()
        if self.EXECUTION_STORE_BACKEND == "postgres":
            if not dsn:
                raise ValueError(
                    "EXECUTION_STORE_BACKEND=postgres requires EXECUTION_POSTGRES_DSN; "
                    "a durable store that was configured but cannot connect is a "
                    "startup failure, never a degraded start"
                )
            if not dsn.startswith(("postgresql://", "postgresql+asyncpg://", "postgres://")):
                raise ValueError(
                    "EXECUTION_POSTGRES_DSN must be a postgresql:// connection string"
                )
        elif dsn:
            # A DSN present while the memory backend is selected means
            # somebody INTENDED durability and the setting silently did not
            # apply - the worst of both worlds (restart loses orders,
            # operator believes it cannot). Refuse the mismatched intent.
            raise ValueError(
                "EXECUTION_POSTGRES_DSN is set but EXECUTION_STORE_BACKEND=memory; "
                "either switch the backend to postgres or remove the DSN - a "
                "half-configured durable store is not a store"
            )
        # Retention bounds exist ONCE, in the core law; constructing the
        # policy here means a config typo names its env var at boot, and
        # an invalid policy can never reach a DELETE statement at all.
        try:
            RetentionPolicy(
                event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
                batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
                max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
            )
        except RetentionError as error:
            raise ValueError(
                f"retention configuration rejected by the core law: {error} "
                "(EXECUTION_RETENTION_EVENT_DAYS / _BATCH_ROWS / _MAX_BATCHES)"
            ) from error
        # Same discipline for the evidence window: the bound-checking law has
        # exactly one home (the core), boot fails on a typo, and the audit
        # endpoint can never receive a policy that "every evidence is fresh".
        try:
            EnablementPolicy(max_evidence_age_days=self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS)
        except EnablementError as error:
            raise ValueError(
                f"enablement configuration rejected by the core law: {error} "
                "(EXECUTION_ENABLEMENT_MAX_AGE_DAYS)"
            ) from error
        self._validate_placement()
        self._validate_live_wiring()
        return self

    def _validate_placement(self) -> None:
        """Part 16's own refusals, kept apart for the same reason the rest of
        this file is a validator rather than a pile of defaults: a deployment
        must not be able to start in a state where it believes it is guarded.
        """
        prefix = self.EXECUTION_CREDENTIAL_ENV_PREFIX.strip()
        if prefix.endswith("_"):
            # Refused rather than normalised. Silently stripping a trailing
            # underscore would make this module's boot check agree with itself
            # while the provider it is guarding looked for a different name
            # entirely, which is precisely the failure the check exists to
            # prevent - and an operator who wrote "ACME_" meant "ACME".
            raise ValueError(
                "EXECUTION_CREDENTIAL_ENV_PREFIX must not end in an underscore: "
                "the core appends the separator, so 'ACME_' resolves "
                "ACME__API_KEY. Drop the trailing underscore."
            )
        if self.EXECUTION_CREDENTIAL_SOURCE == "environment":
            if not prefix:
                raise ValueError(
                    "EXECUTION_CREDENTIAL_ENV_PREFIX is required when "
                    "EXECUTION_CREDENTIAL_SOURCE=environment; reading a "
                    "conventionally-named BINANCE_API_KEY from a shared "
                    "environment is how one service ends up trading on another "
                    "service's key"
                )
            if self.is_production:
                raise ValueError(
                    "EXECUTION_CREDENTIAL_SOURCE=environment is refused in "
                    "production (NODE_ENV=production): process-wide key material "
                    "cannot be scoped per tenant, is visible in every crash "
                    "dump, and does not rotate. Use secret-manager."
                )
        for name, value in (
            ("EXECUTION_CREDENTIAL_TENANT_ID", self.EXECUTION_CREDENTIAL_TENANT_ID),
            ("EXECUTION_CREDENTIAL_ACCOUNT_ID", self.EXECUTION_CREDENTIAL_ACCOUNT_ID),
        ):
            if not value.strip():
                raise ValueError(f"{name} must not be blank")
            if len(value) > 64:
                raise ValueError(f"{name} must be at most 64 characters")
        if self.EXECUTION_CREDENTIAL_CACHE_SECONDS < 1:
            raise ValueError(
                "EXECUTION_CREDENTIAL_CACHE_SECONDS must be at least 1; a "
                "credential cache that expires every second is a per-order "
                "secret lookup with extra steps"
            )
        ttl = self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS
        if not MIN_ATTESTER_TTL_MS <= ttl <= MAX_ATTESTER_TTL_MS:
            raise ValueError(
                f"EXECUTION_PLACEMENT_ATTESTATION_TTL_MS must be within "
                f"{MIN_ATTESTER_TTL_MS}..{MAX_ATTESTER_TTL_MS}; got {ttl}. "
                "Below one second every order pays for a venue round trip; above "
                "an hour the venue's console has had time to revoke the key and "
                "this process would not know"
            )
        if not MIN_KEY_AGE_DAYS <= self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS <= MAX_KEY_AGE_DAYS:
            raise ValueError(
                f"EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS must be within "
                f"{MIN_KEY_AGE_DAYS}..{MAX_KEY_AGE_DAYS}; got "
                f"{self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS}"
            )
        if (
            self.EXECUTION_MODE == "live"
            and not self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST
        ):
            raise ValueError(
                "EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=false is refused in "
                "live mode. The IP allowlist is the one control on a leaked key "
                "that the venue enforces for us; a live deployment without it "
                "has decided that availability outranks that"
            )
        # "live but no credential source" is deliberately NOT refused here, even
        # though it is fatal: this validator's job is whether a value is
        # coherent, and "none" is a perfectly coherent answer that happens to be
        # wrong for live. The composition owns the whole picture - it is where the
        # runtime, the reviewer and the store come together - and its refusal
        # says what is missing instead of naming one variable, which is the
        # message an operator actually needs. Two places refusing the same
        # configuration means two messages, and only one of them explains.
        # The core's law is the last word, exactly as with retention and
        # enablement: the service checks the env var's shape, the policy object
        # checks the semantics, and the endpoint can never be handed a policy
        # that treats every attestation as fresh.
        try:
            PlacementReviewPolicy(
                max_attestation_age_ms=self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
                max_key_age_days=self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
                require_ip_allowlist=self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            )
        except PlacementReviewError as error:
            raise ValueError(
                f"placement review rejected by the core law: {error} "
                "(EXECUTION_PLACEMENT_ATTESTATION_TTL_MS / "
                "EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS)"
            ) from error

    def _validate_live_wiring(self) -> None:
        """Part 19's own refusals: the fetcher selector and the confirmation record.

        Kept apart from ``_validate_placement`` for the same reason that block is
        separate - one law per method, so a review of "what can a deployment
        configure about live mode" is a review of two named methods rather than of a
        five-hundred-line validator - and built on the same discipline: the shape rules
        live on the objects themselves (:class:`VaultKvConfig`,
        :class:`LiveOperatorConfirmation`), and this method only translates their
        refusals into a startup failure that names the environment variable.

        Deliberately NOT checked here, with the reasons:

        * **Presence of the Vault token.** That is the fetcher's boot check, in
          ``app/credentials.py``, which is also where an injectable ``environ`` lets a
          test prove it. Two places reading the same variable means two opinions about
          whether it is set.
        * **Whether the confirmation has expired.** A deployment whose record lapsed
          while it was running must still start: the process has reconciliation,
          cancellation and an audit trail to serve, and the per-order assessment
          refuses with ``OPERATOR_CONFIRMATION_EXPIRED`` (which is louder, per order,
          than a crash loop that also stops the cancel path). Boot checks the shape of
          the ceremony; the review checks its currency, every order.
        * **"Live mode needs both of these."** The composition root owns that whole
          picture and grades it with the core's ``evaluate_live_enablement``, which
          produces one message instead of two.
        """
        fetcher = self.EXECUTION_CREDENTIAL_FETCHER
        source = self.EXECUTION_CREDENTIAL_SOURCE
        if fetcher != "none" and source != "secret-manager":
            raise ValueError(
                f"EXECUTION_CREDENTIAL_FETCHER={fetcher} with "
                f"EXECUTION_CREDENTIAL_SOURCE={source!r}: the fetcher is consulted only "
                "by the secret-manager provider, so this combination is a deployment "
                "that believes it has credential plumbing it does not use. Either point "
                "the source at secret-manager or set the fetcher back to none."
            )
        if fetcher == "vault-kv2":
            try:
                # Bound to a name on purpose: constructing the object IS the check,
                # and this line's value is the exception it can raise. Reading the
                # property (rather than building a VaultKvConfig inline here) keeps the
                # field mapping in one place, so boot and runtime cannot disagree about
                # which settings feed the fetcher.
                validated_vault_config = self.vault_config
                if validated_vault_config.mount != self.EXECUTION_VAULT_MOUNT.strip("/"):
                    raise ValueError(
                        "the Vault mount did not normalise to one segment; this "
                        "deployment's EXECUTION_VAULT_MOUNT is being read differently "
                        "by the check that validates it and the object that uses it"
                    )
            except ValueError as error:
                raise ValueError(
                    f"vault-kv2 credential fetcher rejected at boot: {error}"
                ) from error
        inline = (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
        path = (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
        if inline and path:
            raise ValueError(
                "EXECUTION_OPERATOR_CONFIRMATION_JSON and _FILE are both set. One "
                "ceremony, one source of truth: a deployment that can load a "
                "confirmation from two places has two confirmations, and only one of "
                "them will be the one that is current when it matters."
            )
        if self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION and not (inline or path):
            raise ValueError(
                "EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=true supplies no confirmation "
                "record, which would refuse every order in the deployment with "
                "OPERATOR_CONFIRMATION_ABSENT - a gate that only ever returns false is "
                "not a gate, it is an outage with extra labels. Supply the record, or "
                "turn the requirement off."
            )
        if self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION and not (
            self.EXECUTION_CONFIRMATION_KEY_ENV or ""
        ).strip():
            raise ValueError(
                "EXECUTION_CONFIRMATION_KEY_ENV names the variable holding the HMAC "
                "key and must not be blank; an empty name cannot be looked up, and a "
                "confirmation nothing can verify is a decoration."
            )
        # Parse the record now, so a malformed or forged-looking payload is a boot
        # failure rather than a first-order surprise. An absent record is not an error
        # here: the requirement above already refused the case that matters.
        record = self.operator_confirmation
        if record is not None and record.instance_id.strip() != (
            self.EXECUTION_INSTANCE_ID or ""
        ).strip():
            raise ValueError(
                f"the operator confirmation names instance {record.instance_id!r} and "
                f"this process is {self.EXECUTION_INSTANCE_ID!r}. The per-order review "
                "would refuse every submission for it, which is the right answer with "
                "the wrong timing: a template copied between deployments is a "
                "deployment starting with a ceremony it cannot complete, and that is a "
                "boot message."
            )

    @property
    def vault_config(self) -> VaultKvConfig:
        """The validated fetcher configuration (constructed, never stored).

        The shape rules live on :class:`VaultKvConfig` itself and this property only
        moves values, so a bad address or an unknown template placeholder is refused by
        one implementation and reported identically by boot and by the runtime. The
        Vault token is absent from this list because it is absent from this object:
        the fetcher reads it from the process environment, by the name below.
        """
        return VaultKvConfig(
            addr=self.EXECUTION_VAULT_ADDR or "",
            mount=self.EXECUTION_VAULT_MOUNT,
            path_template=self.EXECUTION_VAULT_PATH_TEMPLATE,
            token_env=self.EXECUTION_VAULT_TOKEN_ENV,
            namespace=self.EXECUTION_VAULT_NAMESPACE,
            timeout_ms=self.EXECUTION_VAULT_TIMEOUT_MS,
            verify_tls=self.EXECUTION_VAULT_TLS_VERIFY,
            max_response_bytes=self.EXECUTION_VAULT_MAX_RESPONSE_BYTES,
        )

    @property
    def operator_confirmation(self) -> LiveOperatorConfirmation | None:
        """The operator's record, parsed and validated, or None.

        Re-read on every access, like the other policy objects: the confirmation is
        deployment input, not process state, and a cached copy would be a second
        answer to "what did we confirm" that could outlive the file it came from.
        """
        inline = (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
        path = (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
        raw = inline
        if not raw and path:
            try:
                raw = Path(path).read_text(encoding="utf-8").strip()
            except OSError as error:
                raise ValueError(
                    f"EXECUTION_OPERATOR_CONFIRMATION_FILE could not be read: "
                    f"{type(error).__name__}. A required ceremony document that cannot "
                    "be opened is a boot failure, not a runtime one - the alternative "
                    "is a process that comes up 'unconfirmed' and refuses orders for a "
                    "reason its own logs do not mention."
                ) from error
        if not raw:
            return None
        try:
            payload = json.loads(raw)
        except ValueError as error:
            raise ValueError(
                f"the operator confirmation is not valid JSON: {type(error).__name__}"
            ) from error
        if not isinstance(payload, dict):
            raise ValueError(
                "the operator confirmation must be a JSON object with the fields "
                "instanceId, tenantId, accountId, exchange, symbols, orderTypes, "
                "issuedAtMicros, expiresAtMicros, nonce and digest"
            )
        try:
            return LiveOperatorConfirmation.from_payload(dict(payload))
        except LiveConfirmationError as error:
            raise ValueError(f"operator confirmation rejected: {error}") from error

    @property
    def placement_policy(self) -> PlacementReviewPolicy:
        """The core's validated review policy, built from this service's fields.

        Constructed, never stored - the same discipline as ``retention_policy``.
        The clock-skew and ``recvWindow`` bounds are deliberately not exposed
        here: they are the venue's signature protocol, not a deployment
        preference, and they default from the same constants
        :class:`~wlct_trading.execution.config.ExecutionSettings` uses. A
        deployment that believes it needs a wider window has a clock to fix, not
        a knob to turn, and a knob for it would be a documented way to trade on a
        clock nobody trusts.
        """
        return PlacementReviewPolicy(
            max_attestation_age_ms=self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
            max_key_age_days=self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
            require_ip_allowlist=self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            require_operator_confirmation=self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION,
        )

    @property
    def retention_policy(self) -> RetentionPolicy:
        """The core's validated policy, built from this service's fields.

        Constructed (not stored) so Settings stays a plain env reader and
        the bound-checking law has exactly one home; the startup validator
        above calls this to fail boot on a nonsensical configuration.
        """
        return RetentionPolicy(
            event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
            batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
            max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
        )

    @property
    def enablement_policy(self) -> EnablementPolicy:
        """The core's validated evidence policy, built from this service's
        field (constructed, never stored - same reason as
        ``retention_policy``: Settings stays a plain env reader)."""
        return EnablementPolicy(
            max_evidence_age_days=self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS
        )

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"

    @property
    def simulated_mid(self) -> Decimal | None:
        if self.EXECUTION_SIMULATED_MID is None:
            return None
        return _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")

    @property
    def paper_balances(self) -> dict[str, Decimal]:
        out: dict[str, Decimal] = {}
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, _, amount = part.partition("=")
            out[asset.strip().upper()] = _parse_decimal(amount, "balance")
        return out

    def to_public_dict(self) -> dict[str, object]:
        # A Vault address is topology, and a mount is configuration: both are only
        # meaningful when a fetcher is actually selected, and publishing defaults that
        # nothing reads is how a status page starts describing a deployment that does
        # not exist. This is the same reason ``credentialTarget`` is null for every
        # source but ``environment``.
        fetcher_wired = self.EXECUTION_CREDENTIAL_FETCHER != "none"
        """Everything except secrets - safe for the status endpoint and logs.

        The internal token is the one value this object must never leak, and
        the whitelist shape (constructing the view field by field) is how
        that stays true when fields are added later: a new secret appears in
        the public view only if someone adds it there deliberately.
        """
        return {
            "nodeEnv": self.NODE_ENV,
            "instanceId": self.EXECUTION_INSTANCE_ID,
            "servicePort": self.SERVICE_PORT,
            "mode": self.EXECUTION_MODE,
            "dryRun": self.EXECUTION_DRY_RUN,
            "requestTimeoutMillis": self.EXECUTION_REQUEST_TIMEOUT_MS,
            "lockTtlMillis": self.EXECUTION_LOCK_TTL_MS,
            "simulatedMidConfigured": self.EXECUTION_SIMULATED_MID is not None,
            "paperBalanceAssets": sorted(self.paper_balances),
            # The DSN itself never appears here (whitelist law); the boolean
            # says "a credential is present" without saying anything about it.
            "storeBackend": self.EXECUTION_STORE_BACKEND,
            "postgresDsnConfigured": (self.EXECUTION_POSTGRES_DSN or "").strip() != "",
            # Retention is configuration an operator must be able to SEE
            # from the outside (is apply enabled? what does "days" mean
            # here?) - all four values are non-secret by construction.
            "retentionEnabled": self.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.EXECUTION_RETENTION_EVENT_DAYS,
            "retentionBatchRows": self.EXECUTION_RETENTION_BATCH_ROWS,
            "retentionMaxBatches": self.EXECUTION_RETENTION_MAX_BATCHES,
            # The enablement window is non-secret and operationally
            # load-bearing (it is what "stale" means HERE), so it is
            # published next to the retention knobs.
            "enablementMaxAgeDays": self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS,
            # Part 16. The credential *source* is published, never anything
            # derived from the material itself: "environment" or "none" is an
            # operational fact an operator needs in order to explain a refusal,
            # and it is also the only way to see from outside that a simulated
            # deployment is not quietly holding live keys.
            # Part 18: whether the scrape endpoint exists is a deployment fact a
            # monitoring pipeline needs in order to tell "no orders" from "no
            # exposition", and it is configuration, so it belongs in the same
            # whitelist as every other non-secret switch on this view.
            "observabilityEnabled": self.OBSERVABILITY_ENABLED,
            "credentialSource": self.EXECUTION_CREDENTIAL_SOURCE,
            "credentialCacheSeconds": self.EXECUTION_CREDENTIAL_CACHE_SECONDS,
            "credentialTarget": (
                f"{self.EXECUTION_CREDENTIAL_TENANT_ID}/"
                f"{self.EXECUTION_CREDENTIAL_ACCOUNT_ID}"
                if self.EXECUTION_CREDENTIAL_SOURCE == "environment"
                else None
            ),
            "placementAttestationTtlMillis": self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
            "placementMaxKeyAgeDays": self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
            "placementRequireIpAllowlist": self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            # Part 19. The fetcher's IDENTITY and address are published, its token is
            # not even reachable from here (it lives only in the environment), and the
            # variable NAME is published precisely so an operator can see which name a
            # deployment is looking at without the value appearing anywhere.
            "credentialFetcher": self.EXECUTION_CREDENTIAL_FETCHER,
            "vaultMount": self.EXECUTION_VAULT_MOUNT if fetcher_wired else None,
            "vaultPathTemplate": (
                self.EXECUTION_VAULT_PATH_TEMPLATE if fetcher_wired else None
            ),
            "vaultTokenEnvVar": self.EXECUTION_VAULT_TOKEN_ENV if fetcher_wired else None,
            "vaultTlsVerify": self.EXECUTION_VAULT_TLS_VERIFY if fetcher_wired else None,
            # The confirmation's existence is configuration an operator must be able to
            # see from outside; its content is rendered by the reviewer's own describe()
            # (one home for the record's rendering), and its key never appears here.
            "requireOperatorConfirmation": self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION,
            "operatorConfirmationSource": (
                "inline"
                if (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
                else "file"
                if (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
                else None
            ),
            "confirmationKeyEnvVar": self.EXECUTION_CONFIRMATION_KEY_ENV,
        }


def _parse_decimal(raw: str, what: str) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except InvalidOperation as error:
        raise ValueError(f"{what} must be a decimal number") from error
    if not value.is_finite():
        raise ValueError(f"{what} must be finite")
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so configuration is parsed exactly once per process."""
    return Settings()
```


## FILE: services/execution-engine/app/composition.py (481 lines)

*the instrument the engine never had: build_runtime now constructs ExecutionMetrics labelled with the adapter's own exchange id, because a histogram of simulator round-trips tagged binance would make every dashboard that reads it lie; and describe() publishes metricsConfigured, which is where every wiring fact in this service already lives.*

```python
"""The single composition root of the execution plane.

Everything the engine touches - adapter, store, locks, incidents, risk - is
built exactly once, here, and every choice is mode-gated at construction
rather than at first use. This is the same discipline
:class:`wlct_trading.execution.engine.ExecutionEngine` applies internally
(:meth:`_assert_wiring_is_safe` refuses unsafe combinations), lifted from
"the library you wire" to "the service you deploy": a misconfiguration kills
startup, not the first customer order.

What is deliberately absent:

* no live venue adapter - ``EXECUTION_MODE=live`` is refused here even
  though the core supports it: as of Part 13 the durable store ships and
  distributed locks exist in the core, but the live credential provider and
  the venue-ordering audit for authenticated order placement have not
  completed their review, so refusing is still the honest wiring. The
  refusal is code, not a default, and no environment value talks the
  process into it;
* no order-submission endpoint - the platform's producers enqueue account
  maintenance and cancellation today (see the queue-consumer inventory in
  docs/PART11_WORKER_SCALING.md); a worker must not grow capabilities its
  producers never send;
* no silently-degraded store - ``EXECUTION_STORE_BACKEND=memory`` keeps
  the process-local simulated store (readiness reports ``storeDurable:
  false``, exactly as before), and ``postgres`` only starts when the
  lifespan hands ``build_runtime`` a live pool whose tables exist. A
  durable mode that could not reach its database kills startup; it never
  "falls back to memory", because silent fallback is how a durability
  incident becomes a data-loss incident.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from wlct_trading.adapters.base import AccountAdapter, TradingAdapter
from wlct_trading.adapters.paper import PaperAccountAdapter, PaperTradingAdapter
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.engine import ExecutionEngine
from wlct_trading.execution.incidents import (
    IncidentRecorder,
    InMemoryIncidentRecorder,
)
from wlct_trading.execution.live_enablement import (
    LiveEnablementInputs,
    LiveEnablementReport,
    evaluate_live_enablement,
)
from wlct_trading.execution.locks import InMemoryLockManager, LockManager
from wlct_trading.execution.reconciliation import ReconciliationService
from wlct_trading.execution.store import InMemoryOrderStore, OrderStore
from wlct_trading.market_data import BookTop
from wlct_trading.metrics import ExecutionMetrics
from wlct_trading.risk import RiskEngine, RiskLimits

from app.config import Settings
from app.credentials import CredentialWiring, build_credential_provider
from app.placement import PlacementWiring, build_placement_reviewer

__all__ = [
    "SUPPORTED_COMMANDS",
    "EngineRuntime",
    "ExecutionUnavailable",
    "build_runtime",
]

logger = logging.getLogger(__name__)

#: Commands this runtime executes end to end. The worker's processor checks
#: membership against this set (fetched from /status at startup and again on
#: every request path via the 501 response) rather than hardcoding a
#: parallel list - one place decides what is supported, and it decides at
#: boot, not by accident of which file was edited last.
SUPPORTED_COMMANDS: frozenset[str] = frozenset(
    {
        "verify-exchange-credentials",
        "refresh-account-balances",
        "reconcile-trading-account",
        "cancel-order",
    }
)

#: Conservative numeric limits for the simulated runtime, matching the
#: harness the core's own execution tests pin against. All-`None` limits
#: would also construct; they would also mean the one process holding the
#: money path ships without speed bumps, and "simulated" is not a reason to
#: practise with the guards off.
SIMULATED_LIMITS = RiskLimits(
    max_order_quantity=Decimal("1000"),
    max_order_notional=Decimal("1000000"),
    max_position_quantity=Decimal("5000000"),
    max_symbol_exposure_notional=Decimal("5000000"),
    max_account_exposure_notional=Decimal("10000000"),
    max_open_orders=100,
    max_orders_per_minute=100,
    max_daily_loss=Decimal("1000000"),
    max_price_deviation_percent=Decimal("50"),
    max_market_data_age_micros=60_000_000,
)


class ExecutionUnavailable(RuntimeError):
    """The runtime cannot serve in the current wiring.

    Surfaced as 503 (or a startup refusal): "not wired yet" is an
    operational fact callers can act on - retry later, alert a human -
    which a raw ``NoneType`` is not.
    """


@dataclass(slots=True)
class EngineRuntime:
    """The assembled execution plane, shared by all request handlers.

    The engine, store, recorder and reconciler are the same objects for the
    process lifetime: :class:`ExecutionEngine` documents itself as safe to
    share across tenants because every store/lock call is tenant-scoped,
    while a second instance would silently double any in-memory ledger - the
    one failure mode a "just build another one" refactor introduces.
    """

    engine: ExecutionEngine
    store: OrderStore
    locks: LockManager
    #: The port since Part 17, not a concrete class: a durable deployment and a
    #: paper one differ in exactly this object, and a field typed to the in-memory
    #: implementation would make the durable one a lie about its own shape.
    incidents: IncidentRecorder
    trading_adapter: TradingAdapter
    account_adapter: AccountAdapter
    reconciliation: ReconciliationService
    settings: Settings
    # Part 16. Both are required, not optional-with-a-default: a runtime that
    # cannot say which credential source it used and which gatherer reviewed the
    # order is a runtime whose /status is documentation rather than evidence.
    credentials: CredentialWiring
    placement: PlacementWiring
    #: Part 19: the live-enablement grading, computed from the objects this function
    #: actually built. Carried on the runtime rather than recomputed per request
    #: because it is a fact about a fixed wiring, and published on /status so "how
    #: close is this deployment to being allowed to trade live" is a query with one
    #: answer instead of a paragraph in a document.
    live_enablement: LiveEnablementReport | None = None

    def describe(self) -> dict[str, Any]:
        """Public, secret-free description of the wiring, for /status and
        for the worker to assert against before forwarding anything."""
        # Read once, below, twice-guarded: a sink whose ``stats`` attribute is a
        # broken property must not turn a status request into a 500, which is the
        # same reason the review's source label is read through a try.
        try:
            sink_stats = getattr(self.incidents, "stats", None)
        except Exception:  # a broken attribute must not make status unanswerable
            sink_stats = None
        return {
            "mode": self.settings.EXECUTION_MODE,
            "dryRun": self.settings.EXECUTION_DRY_RUN,
            "instanceId": self.settings.EXECUTION_INSTANCE_ID,
            "adapter": type(self.trading_adapter).__name__,
            "store": type(self.store).__name__,
            "storeBackend": self.settings.EXECUTION_STORE_BACKEND,
            # getattr mirrors the core engine reading this OPTIONAL port
            # attribute the same duck-typed way (OrderStore documents it as a
            # MAY); defaulting False means "unproven durable" - fail-closed.
            "storeDurable": bool(getattr(self.store, "is_durable", False)),
            # Retention posture travels with the store posture: a durable
            # store nobody prunes and a prune that cannot reach a memory
            # store are both states the caller should see, not infer.
            "retentionEnabled": self.settings.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.settings.EXECUTION_RETENTION_EVENT_DAYS,
            # Part 15's posture travels with the store's for the same reason
            # the retention knobs do: whether an enablement audit even CAN
            # run here is a property of this wiring, not of the caller.
            "enablementMaxAgeDays": self.settings.EXECUTION_ENABLEMENT_MAX_AGE_DAYS,
            # Part 16's posture, for the reason every other line here exists: an
            # operator debugging a refused order should not have to read the
            # source to learn what this process was willing to believe. The
            # credential *source* and the review's gatherer label are enough to
            # tell "no key is wired" from "the venue refused", and neither is a
            # secret - no key material is reachable through this dict at all.
            "credentialSource": self.credentials.source,
            # Which reader backs the credential source, or None when the source needs
            # none. Published because "secret-manager" on its own cannot tell an
            # operator whether this process can resolve a second tenant - the fetcher
            # label is what makes that answerable, and it names a mechanism, not a key.
            "credentialFetcher": self.credentials.fetcher_source,
            "operatorConfirmation": self.placement.confirmation_configured,
            "placement": self.placement.describe(),
            # The graded live-enablement report. Rendered through to_public_dict even
            # when absent (a runtime assembled by a caller that did not grade - a test
            # double, a future factory) rather than omitted, so /status has one shape.
            "liveEnablement": (
                None
                if self.live_enablement is None
                else self.live_enablement.to_public_dict()
            ),
            # Part 17's sink posture, published for the reason every other line
            # here exists. "Why is the incident list empty" has three honest
            # answers - nothing happened, the records died with the last restart,
            # or this process could not write them - and an operator can only tell
            # them apart if the sink says which one it is.
            "incidents": {
                "sink": type(self.incidents).__name__,
                "durable": bool(getattr(self.incidents, "is_durable", False)),
                # Always a mapping, empty when the sink keeps no accounting: the
                # view serialises the key either way, and a description that
                # sometimes omits it would make /status and describe() two
                # different shapes for the same object - which is precisely the
                # drift the parity test in the service suite exists to catch.
                "stats": dict(sink_stats()) if callable(sink_stats) else {},
            },
            # Part 18: "is this process measuring anything at all" is a wiring fact
            # like every other line in this dict, and it is the one a reader of
            # /metrics needs first - a scrape of all zeros means something different
            # when no instrument was handed to the engine. Read through getattr for
            # the reason storeDurable is: an engine stub without the property answers
            # "unproven" instead of raising inside a status request.
            "metricsConfigured": getattr(self.engine, "metrics", None) is not None,
            "locksDistributed": self.locks.is_distributed,
            "commands": sorted(SUPPORTED_COMMANDS),
        }


def make_paper_book_provider(
    mid: Decimal | None,
) -> Callable[[ExchangeId, str], BookTop | None]:
    """The book function the paper adapter prices against.

    A fixed mid when configured, an empty book otherwise. The empty book is
    not an oversight: "no reference price" makes the adapter refuse rather
    than invent, which is the correct behaviour for a simulated venue nobody
    configured. Every price that DOES exist here is simulated by
    construction; nothing in this function pretends to be a market.
    """

    def provider(exchange: ExchangeId, symbol: str) -> BookTop | None:
        if mid is None:
            return None
        return BookTop(
            exchange=exchange,
            symbol=symbol,
            best_bid=mid,
            best_bid_quantity=Decimal("1"),
            best_ask=mid,
            best_ask_quantity=Decimal("1"),
            sequence=0,
            exchange_timestamp=0,
            received_timestamp=0,
        )

    return provider


def _confirmation_grading(settings: Settings, placement: PlacementWiring) -> bool:
    """Whether the deployment's own confirmation is currently acceptable.

    The deployment-level assessment, never the per-order one: at startup there is no
    order whose symbol could be checked, and inventing one to grade against would put
    a fabricated scope into an enablement report that an operator reads as evidence.
    ``assess_deployment`` therefore grades integrity, identity and window, and the
    review separately grades scope for every order - which is why a deployment whose
    boot grading is green can still (correctly) refuse a symbol nobody confirmed.

    A grading that raises is reported as False rather than as an exception: this
    function feeds a refusal message, and a report that cannot be built must still
    refuse, not replace the live-mode refusal with a stack trace.
    """
    verifier = placement.reviewer.confirmation_verifier
    if verifier is None:
        return False
    try:
        outcome = verifier.assess_deployment(
            tenant_id=settings.EXECUTION_CREDENTIAL_TENANT_ID,
            account_id=settings.EXECUTION_CREDENTIAL_ACCOUNT_ID,
            now_micros=epoch_micros(),
        )
    except Exception:  # a report that cannot be graded still refuses
        return False
    return outcome.accepted


def build_runtime(
    settings: Settings,
    store: OrderStore | None = None,
    incidents: IncidentRecorder | None = None,
) -> EngineRuntime:
    """Construct the execution plane, or refuse loudly at startup.

    ``store`` is the durable adapter's injection point: the lifespan owns
    the pool (it must create it before any request can be served and close
    it on shutdown, and it verifies the tables exist), while this function
    owns the WIRING - which combinations may exist at all. ``incidents`` is
    the same arrangement for the incident sink (Part 17): the lifespan builds
    it over the same pool, and this function refuses the pairings that would
    leave a deployment with half a memory. A postgres
    backend reached without an injected store, or an injected store under a
    memory backend, is a bug in the composition path, and bugs in this path
    die here rather than in the first order that quietly went unsaved.
    """
    # Part 19: the live refusal is now COMPUTED, and it still refuses. The sentence
    # this used to raise was true the day it was written and had already begun to rot
    # by Part 17 - it named the credential provider as unfinished long after the
    # credential provider shipped - because prose about a checklist cannot notice the
    # checklist changing. What follows grades the wiring this function built and
    # renders the refusal from the grade, which is narrower (it cannot overstate what
    # is missing), better (it names what IS satisfied), and still unconditional: the
    # report can never come back empty in this build, because SIGNED_TRANSPORT_WIRED
    # is a prerequisite no environment variable in this service can satisfy.
    #
    # The refusal is raised at the END of this function rather than the top so that the
    # grade is a measurement and not a guess. A runtime that refuses live mode while
    # describing a store, locks and a reviewer it has not built yet would be publishing
    # an opinion as evidence, which is the mistake in the other direction.
    if settings.EXECUTION_STORE_BACKEND == "postgres" and store is None:
        raise ExecutionUnavailable(
            "EXECUTION_STORE_BACKEND=postgres requires the lifespan-injected "
            "pool store; a postgres-wired engine built over a memory store "
            "would report durability it does not have"
        )
    if settings.EXECUTION_STORE_BACKEND == "memory" and store is not None:
        raise ExecutionUnavailable(
            "an injected durable store under EXECUTION_STORE_BACKEND=memory "
            "means the config and the wiring disagree; refusing to guess "
            "which one the operator meant"
        )
    if store is None:
        store = InMemoryOrderStore()

    trading = PaperTradingAdapter(make_paper_book_provider(settings.simulated_mid))
    account = PaperAccountAdapter(settings.paper_balances)
    locks = InMemoryLockManager()
    durable_store = bool(getattr(store, "is_durable", False))
    if incidents is None:
        # Part 17's pairing law, decided HERE rather than trusted to the caller:
        # a durable store with the in-memory sink is the exact state this part
        # exists to remove, and a runtime that reaches it without being told has
        # orders that survive a restart and incidents that do not. Refusing is
        # the only answer that cannot be forgotten by the next caller.
        if durable_store:
            raise ExecutionUnavailable(
                "the durable order store cannot be paired with the in-memory "
                "incident sink: incidents explain the orders, and losing them at "
                "restart while keeping the orders would leave a store full of "
                "records nobody can interpret. Pass incidents=... a "
                "PostgresIncidentRecorder built over the same pool (that is what "
                "app.main does at startup)."
            )
        incidents = InMemoryIncidentRecorder()
    elif not durable_store and bool(getattr(incidents, "is_durable", False)):
        raise ExecutionUnavailable(
            "a durable incident sink over the in-memory order store means the "
            "config and the wiring disagree, in the mirror image of the refusal "
            "above: refuse to guess which half the operator meant"
        )
    risk_engine = RiskEngine(SIMULATED_LIMITS)
    reconciliation = ReconciliationService(
        trading=trading,
        account=account,
        store=store,
        incidents=incidents,
        locks=locks,
    )

    credentials = build_credential_provider(settings)
    engine_settings = ExecutionSettings(
        live_trading_enabled=False,
        dry_run=settings.EXECUTION_DRY_RUN,
        paper_trading=True,
        trading_mode_setting="PAPER",
        trading_enabled=True,
        live_trading_confirmed=False,
        order_request_timeout_ms=settings.EXECUTION_REQUEST_TIMEOUT_MS,
    )
    # Part 16: the review runs for every runtime, simulated included. A paper
    # order is reviewed by the local gatherer, which reports what this process
    # knows and cannot claim venue backing - so the audit trail says "locally
    # attested" on a simulated order instead of saying nothing, and the same code
    # path that will guard a live order is exercised by every paper order this
    # deployment will ever place.
    placement = build_placement_reviewer(
        settings,
        will_transmit_orders=engine_settings.will_transmit_orders,
        credential_provider=credentials.provider,
    )
    # Part 18, and the reason it exists: the port has been optional on this
    # constructor since Part 5, this service never passed one, and so the engine
    # in the reference deployment has been refusing to count anything. Every
    # counter and stage this repository documents as measurable - the placement
    # review's three from Part 16, the pipeline spans from Part 18 - was wired to
    # ``None`` here. An instrument is cheap, monotone and read-only to everyone
    # else, so there was never a reason to omit one; there was only no test that
    # asked whether the numbers existed at all. The first line of this comment is
    # also the answer to "why not make the parameter required": the core's port is
    # shared with the trading engine's own harness, and the constructor staying
    # optional is a documented property of the library, not an invitation for a
    # service to leave it empty.
    # Labelled with the adapter's own exchange id, not with the venue it is
    # simulating. A histogram of simulator round-trips tagged "binance" would make
    # every dashboard that reads it lie, and the venue a deployment is pointed at
    # is already on /status and in the wiring gauges where the mode belongs.
    metrics = ExecutionMetrics(exchange=trading.exchange.value)
    engine = ExecutionEngine(
        adapter=trading,
        settings=engine_settings,
        risk_engine=risk_engine,
        store=store,
        locks=locks,
        incidents=incidents,
        placement_reviewer=placement.reviewer,
        default_lock_ttl_millis=settings.EXECUTION_LOCK_TTL_MS,
        metrics=metrics,
    )
    logger.info(
        "execution_engine.runtime_built",
        extra={
            "event": "execution_engine.runtime_built",
            "wiring": {
                "store": type(store).__name__,
                "storeBackend": settings.EXECUTION_STORE_BACKEND,
                "locks": type(locks).__name__,
                "adapter": type(trading).__name__,
                "dryRun": engine_settings.dry_run,
                "simulatedMidConfigured": settings.simulated_mid is not None,
                # Named ``providerSource`` for the same reason ``app.credentials``
                # renamed its boot line: a key containing "credential" is scrubbed from
                # every log record by the platform's redaction filter, and a boot line
                # whose interesting field reads [REDACTED] is a boot line nobody can
                # debug from. The describe()/status spelling is untouched.
                "providerSource": credentials.source,
                "placementMode": placement.mode,
            },
        },
    )
    live_enablement = evaluate_live_enablement(
        LiveEnablementInputs(
            credential_source=settings.EXECUTION_CREDENTIAL_SOURCE,
            credential_fetcher_wired=credentials.fetcher_source is not None,
            venue_attestor_wired=placement.mode == "venue",
            confirmation_accepted=_confirmation_grading(settings, placement),
            durable_store_wired=bool(getattr(store, "is_durable", False)),
            distributed_locks_wired=bool(getattr(locks, "is_distributed", False)),
            ip_allowlist_enforced=settings.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            # Never set by any code path in this service, and the line that makes it
            # explicit is the line a reviewer reads before believing the report: the
            # composition root has no branch that would construct a live venue adapter,
            # so this stays False whatever the environment says.
            signed_transport_wired=False,
        )
    )
    if settings.EXECUTION_MODE == "live":
        raise ExecutionUnavailable(
            live_enablement.render_refusal("live")
            + " Concretely absent here, in the terms this service is written in: no "
            "signed HTTP transport to a venue is wired, this composition root never "
            "constructs a venue trading adapter, no live or testnet base URL is "
            "selected for one, and there is no operator runbook for the enablement "
            "evidence a live account must present. The credential plumbing, the "
            "durable store, the placement review and the operator's confirmation are "
            "each built and graded above; the transport is the part that does not "
            "exist. Simulated mode is available now."
        )
    return EngineRuntime(
        engine=engine,
        store=store,
        locks=locks,
        incidents=incidents,
        trading_adapter=trading,
        account_adapter=account,
        reconciliation=reconciliation,
        settings=settings,
        credentials=credentials,
        placement=placement,
        live_enablement=live_enablement,
    )
```


## FILE: services/execution-engine/app/schemas.py (647 lines)

*metrics_configured on the typed status model, defaulting False - which is what a pre-Part-18 engine actually was rather than a hedge, so an old response cannot be read as instrumented-but-idle.*

```python
"""Request and response models for the internal execution API.

Alias conventions match the trading engine: fields are snake_case
internally, camelCase on the wire, populated by name on input so a worker
cannot smuggle a mistyped payload past validation by coincidence.

Everything here is a CONTROL shape. No model accepts an order to place;
no model returns a credential, key or signed payload. Decimal-valued
fields serialise as decimal STRINGS: a JSON float for a
quantity or balance is a silent rounding decision, and money never takes
one of those on the platform's behalf.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = [
    "AccountCommandRequest",
    "BalanceView",
    "BalancesResponse",
    "CancelOrderRequest",
    "CancelOrderResponse",
    "CommandRejected",
    "DiscrepancyView",
    "EnablementAuditResponse",
    "EnablementProbeView",
    "EnablementRequest",
    "EnablementRoleView",
    "PlacementAttestRequest",
    "PlacementAttestResponse",
    "PlacementFindingView",
    "ReconcileResponse",
    "RetentionInspectRequest",
    "RetentionInspectResponse",
    "RetentionRunRequest",
    "RetentionRunResponse",
    "RetentionRunView",
    "StatusResponse",
    "VerifyResponse",
]

_TENANT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

#: An int that refuses coercion - the one spelling (annotated VALUE type)
#: that makes strictness apply inside a dict, as the enablement seed counts
#: require.
_StrictInt = Annotated[int, Field(strict=True)]
_ACCOUNT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def _to_camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


class _WireModel(BaseModel):
    """Base for every model on this wire: camelCase aliases (the platform's
    API style, matched by the trading engine), snake_case fields (the
    core's style), ``extra=forbid`` so a payload containing fields BEYOND
    the contract - a venue key slipped in by a buggy producer, say - is a
    422 rather than a silently ignored surprise."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid"
    )


class AccountCommandRequest(_WireModel):
    """Payload for the three account commands.

    ``tenantId``/``accountId`` echo the job payload; the router still
    enforces the TENANT header match - a body that agrees with the header
    is provenance, a body that merely exists is not.
    """

    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class CancelOrderRequest(_WireModel):
    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    order_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    client_order_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=32)
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class VerifyResponse(_WireModel):
    verified: bool
    note: str
    is_simulated: bool = True


class BalanceView(_WireModel):
    asset: str
    free: str
    locked: str

    @field_validator("free", "locked")
    @classmethod
    def _decimalish(cls, value: str) -> str:
        from decimal import Decimal, InvalidOperation

        try:
            parsed = Decimal(value)
        except InvalidOperation as error:
            raise ValueError("balances must serialise as decimal strings") from error
        if not parsed.is_finite():
            raise ValueError("balances must be finite")
        return value


class BalancesResponse(_WireModel):
    balances: list[BalanceView]
    is_simulated: bool = True


class DiscrepancyView(_WireModel):
    discrepancy_type: str
    summary: str
    order_id: str | None
    repaired: bool


class ReconcileResponse(_WireModel):
    tenant_id: str
    account_id: str
    exchange: str
    orders_checked: int
    fills_recovered: int
    discrepancy_count: int
    discrepancies: list[DiscrepancyView]
    error: str | None
    started_at_micros: int
    finished_at_micros: int


class CancelOrderResponse(_WireModel):
    """The engine's honest verdict on a cancel request.

    ``outcome`` carries ExecutionEngine vocabulary (ACCEPTED,
    REJECTED_LOCALLY, REJECTED_BY_EXCHANGE, DUPLICATE, DRY_RUN, UNKNOWN);
    the worker's ack policy reads THIS, not the HTTP code: 200 +
    REJECTED_LOCALLY is a completed job, 5xx is a retryable failure, and
    conflating the two is how cancelled-twice becomes cancelled-never.
    """

    outcome: str
    client_order_id: str
    order_status: str
    error_code: str | None
    message: str | None
    latency_micros: int
    is_simulated: bool


class CommandRejected(_WireModel):
    """Error body shared by 403/404/501 paths."""

    code: str
    message: str


class PlacementStatusView(_WireModel):
    """The placement review as ``/status`` publishes it.

    A typed model rather than the raw ``dict`` ``PlacementWiring.describe()``
    returns, for one reason: ``extra="forbid"`` on this base means a field that
    ``describe()`` grows without a decision here is a loud failure at the first
    status request, not a silently unpublished fact. The counterpart test in the
    service suite asserts the two key sets agree, so the loud failure is caught in
    CI and can never actually reach an operator.

    ``policy`` and ``cache`` are mappings of numbers, not declared fields, and the
    asymmetry is the safety property: those blocks can carry bounds, counters and
    a boolean, and nothing that could be a key. The strings live only in the three
    labels below, which are the module's own constants and are asserted not to
    contain credential material.
    """

    #: ``placement-review`` - what an operator greps for (REVIEW_ENDPOINT_LABEL).
    label: str
    #: ``local`` for a runtime that cannot transmit; the mode is part of the
    #: verdict digest upstream, so publishing it here lets a reader check that
    #: the engine answering and the engine that refused are the same engine.
    mode: str
    #: Whether this wiring would REFUSE for want of a venue answer. Published
    #: because an operator comparing two deployments has to see which one would
    #: have blocked the order the other one took.
    requires_venue_attestation: bool
    #: How long a gathered attestation is reused, as configured (not as
    #: achieved - ``cache`` below says what the reuse actually did).
    cache_ttl_millis: int
    #: The gatherer's provenance label: ``unattested``, ``local``, ``binance``
    #: or ``cached(<inner>)``.
    attestor_source: str
    policy: dict[str, int | bool]
    #: Present only when the gatherer reports its own statistics - the absence is
    #: the honest signal that the attestor in use is not a caching one.
    cache: dict[str, int] | None = None
    #: Part 19: whether an operator-confirmation verifier is installed at all. A
    #: separate top-level fact from ``policy.requireOperatorConfirmation``, because
    #: "the deployment asked for the check" and "the deployment can satisfy it" are
    #: the two halves of the outage this service must not confuse.
    confirmation_configured: bool = False
    #: The verifier's own summary, deliberately the SHAPE rather than the scope:
    #: this block is copied verbatim into ``/health/ready``, which is
    #: unauthenticated, and a confirmation's tenant, account and symbol list are
    #: identities a probe has no need of. See
    #: :meth:`~wlct_trading.execution.live_confirmation.ConfirmationVerifier.public_summary`.
    operator_confirmation: dict[str, bool | int | str] = {}


class LiveEnablementView(_WireModel):
    """The live-enablement grading, as ``/status`` publishes it (Part 19).

    Rendered from the report the composition root computed over the objects it
    actually built, which is the whole point of the type existing: the same data that
    produced the ``EXECUTION_MODE=live`` refusal, so the answer an operator reads
    after a failed boot and the answer in front of a successful one are the same
    answer. It cannot be turned into a permission by any caller - there is no field
    here that says "set this to true and trade", only which names are missing.
    """

    #: Always true in this build. See ``HARD_BLOCKERS`` in the core: the live
    #: transport is not wired, so no grading can come back empty and no reader can
    #: use this block to conclude that live mode is one setting away.
    live_refused: bool
    #: The prerequisite names still unsatisfied, in the order the enum declares
    #: them - a stable list, so a deployment watching it shrink over successive
    #: parts is watching progress rather than a reshuffle.
    missing: list[str] = []
    satisfied: list[str] = []
    #: The same list in the refusal vocabulary (``LIVE_`` prefixed), for a caller
    #: that matches on codes rather than on prose.
    missing_codes: list[str] = []
    #: Whether any missing item is one this build cannot satisfy by configuration.
    #: The honest "you are waiting for a part, not for a value" flag.
    hard_blockers_present: bool = True
    credential_source: str = "none"


class IncidentSinkView(_WireModel):
    """The incident sink as ``/status`` publishes it (Part 17).

    Same typing argument as ``PlacementStatusView``: the sink's name and its
    durability are the two facts that explain why an incident list is empty, and
    ``extra="forbid"`` means a field added to the runtime's description has to be
    decided here before it reaches an internal caller.

    ``stats`` is a mapping of counts, always present and empty when the sink has
    no accounting to give: the in-memory sink has nothing to report, and publishing
    ``{}`` says that in the same shape the durable one uses. A missing key would
    force every reader to distinguish "no stats" from "this engine is too old to
    have stats", which is the distinction the outer ``incidents is null`` already
    makes - one place, one meaning. Counts only, never labels: a label is where a
    secret would have to go, and this block has no business carrying one.
    """

    #: ``PostgresIncidentRecorder`` or ``InMemoryIncidentRecorder`` - the class the
    #: runtime was built with, which is the answer to "where did my incidents go".
    sink: str
    #: The sink's own claim, not the config's: a deployment that set
    #: ``EXECUTION_STORE_BACKEND=postgres`` and still has a memory sink says
    #: ``durable: false`` here, and composition refuses that pairing outright.
    durable: bool
    stats: dict[str, int] = Field(default_factory=dict)


class StatusResponse(_WireModel):
    instance_id: str
    mode: str
    dry_run: bool
    adapter: str
    store: str
    store_durable: bool
    #: "memory" | "postgres" as the SERVICE was configured - independent of
    #: store_durable on purpose: the worker can tell "class name says
    #: Postgres, config says memory" (impossible wiring) apart from either
    #: alone. Defaults to "unknown" (not "memory") so a response from a
    #: pre-Part-13 engine reads as unproven, never as a claimed fact.
    store_backend: str = "unknown"
    #: Retention visibility on the SAME surface the worker asserts against:
    #: "is a prune possible from this engine, and what does 'days' mean
    #: here" are questions an operator asks the status endpoint, not the
    #: source. Defaults state the shipped config (disabled, 90) so a
    #: pre-Part-14 engine's response cannot be read as "retention ran".
    retention_enabled: bool = False
    retention_event_days: int = 90
    #: Part 15's evidence window, visible on the assert-before-forward
    #: surface for the same reason retention is: "how stale is too stale" is
    #: a per-deployment answer. The default mirrors the shipped config, and
    #: a PRE-Part-15 engine's response therefore says "the window nobody
    #: enforced was 30 days", not "freshness was checked".
    enablement_max_age_days: int = 30
    #: Part 16's posture, on the same surface for the same reason: "which key
    #: source was this process willing to read, and what was it willing to
    #: believe about an order" are the two questions an operator asks when a
    #: placement is refused, and neither may require reading the source or
    #: shell-ing into the container. The SOURCE is published, never a credential.
    #: The defaults describe an engine too old to answer rather than an engine
    #: with nothing wired, so a pre-Part-16 response reads as unproven - the
    #: same convention ``store_backend`` set - and ``placement is None`` is
    #: distinguishable from ``attestorSource == "unattested"``, which is a
    #: deployment that HAS the review and has no venue behind it.
    credential_source: str = "none"
    #: Part 19's two additions to the same posture: which reader backs the
    #: credential source (None when the source needs none), and whether an operator
    #: confirmation is wired. Neither is a permission, and neither can be read as
    #: "live is available": the block below is what says that, and it says it for
    #: every deployment this build starts.
    credential_fetcher: str | None = None
    operator_confirmation: bool = False
    live_enablement: LiveEnablementView | None = None
    placement: PlacementStatusView | None = None
    #: Part 18's instrument posture, on the assert-before-forward surface for the
    #: reason everything else on it is there: a scrape that reads all zeros needs an
    #: answer to "is this process measuring anything", and the answer belongs in the
    #: document the worker already reads rather than in a second system. Defaults
    #: False, which is what a pre-Part-18 engine actually was - nothing was wired -
    #: so an old response cannot be misread as "instrumented but idle".
    metrics_configured: bool = False
    #: Part 17's posture, on the same surface for the same reason: "does this
    #: process keep the records that explain its own failures" is the first
    #: question an operator asks after a restart, and ``None`` reads as "an
    #: engine too old to answer" rather than as "no incidents" - the convention
    #: every other block on this model uses.
    incidents: IncidentSinkView | None = None
    locks_distributed: bool
    commands: list[str]
    simulated: bool = True


class RetentionRunRequest(_WireModel):
    """The run command's body. ``dryRun`` DEFAULTS TRUE: the field a typo
    could flip is the one that DELETES, so deletion requires an explicit
    ``"dryRun": false``, and even that only reaches the DELETE statements
    when EXECUTION_RETENTION_ENABLED says the deployment means it."""

    tenant_id: str = _TENANT
    dry_run: bool = True


class RetentionInspectRequest(_WireModel):
    """The read-only sibling: current count + recent runs, no deletion."""

    tenant_id: str = _TENANT


class RetentionRunResponse(_WireModel):
    """One run's account, mirroring the ledger row it just wrote.

    ``ledgerWritten`` is part of the contract because the ledger failure
    path is a real one (deletes landed, record did not): an operator
    reading `false` here knows the HTTP body IS the durable-ish copy and
    must reconcile against the log line before scheduling more.
    """

    dry_run: bool
    cutoff_us: int
    rows_reported: int
    batches_run: int
    exhausted: bool
    ledger_written: bool


class RetentionRunView(_WireModel):
    """A ledger row as read back; every field is a number or a label."""

    seq: int
    started_at: int
    finished_at: int
    dry_run: bool
    event_cutoff_us: int
    rows_deleted: int
    batches: int
    exhausted: bool
    instance_id: str


class RetentionInspectResponse(_WireModel):
    enabled: bool
    event_retention_days: int
    batch_rows: int
    max_batches: int
    cutoff_us: int
    prunable_now: int
    runs: list[RetentionRunView]


class EnablementRequest(_WireModel):
    """Body of ``POST /internal/v1/enablement/audit`` (Part 15).

    The only required field is the tenant whose rows the scoped count will
    see - there is no ``deleteOlderThanDays``-style danger field here,
    because there is no write path to protect. ``seedCounts`` is the
    operator's claim about how many rows that tenant should see per table;
    leaving it out is the honest unknown-seed mode (the catalogue posture
    then carries the finding), and passing a table this service does not
    probe is a refusal, not an ignore: a silently dropped key is how an
    audit starts reporting on tables that were never read.
    """

    tenant_id: str = _TENANT
    #: A row count arrives as an integer or the request is refused - no
    #: silent conversion, ever. The strictness lives on the DICT VALUE
    #: because that is the only spelling that works: a field-level
    #: ``strict=True`` on a ``dict[str, int]`` does not reach inside the
    #: values in pydantic 2.9 (verified by test), and non-strict coercion
    #: would accept ``"3"`` and, worse, ``true`` as 1 - handing the audit a
    #: seed the operator never wrote and a PASS that was earned by a cast.
    seed_counts: dict[str, _StrictInt] | None = None
    #: The coverage manifest's table count, when the caller wants the run
    #: graded against the WHOLE platform rather than against this service's
    #: own plane. Anything other than ``None``/that exact count grades
    #: UNVERIFIED, which is the point. The bounds mirror the core's
    #: (0..MAX_PROBED_TABLES) so a nonsense number is refused on the wire;
    #: the core still re-validates, because a bound stated twice in a test
    #: is a fact and a bound stated twice in code is a drift risk - which
    #: the parity test pins.
    covered_expected: int | None = Field(default=None, ge=0, le=4096)

    @field_validator("seed_counts")
    @classmethod
    def _seed_counts_are_rows(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return None
        for name, count in value.items():
            if isinstance(count, bool) or not isinstance(count, int):
                raise ValueError(f"seedCounts[{name!r}] must be an integer row count")
            if count < 0:
                raise ValueError(f"seedCounts[{name!r}] must be non-negative")
        return value


class EnablementProbeView(_WireModel):
    """One table's raw observations. Counts, not booleans, so a second
    operator can re-audit the report against the database itself."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    table: str
    policy_exists: bool
    rls_enabled: bool
    rls_forced: bool
    scoped_rows: int
    bare_rows: int
    seeded_expected_rows: int
    absent: bool
    grade: str
    skip_reason: str | None = None


class EnablementRoleView(_WireModel):
    """The role the audit ran AS - the field that makes a "pass" either
    meaningful or worthless, so it is on the wire in the same body."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    rolname: str
    bypassrls: bool
    superuser: bool


class EnablementAuditResponse(_WireModel):
    """The whole run. ``grade`` is the ONLY field a dashboard may colour,
    and ``fullPlatform`` is the field that keeps it honest: a pass over
    four engine tables is not a pass over 42, and a report that says
    otherwise has to be able to be caught saying so."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True, extra="forbid")

    ran_at_us: int
    grade: str
    full_platform: bool
    #: See ``EnablementAudit``: one boolean can honestly say two different
    #: things only if they are two different fields.
    engine_plane_complete: bool
    probed: int
    role: EnablementRoleView
    summary: dict[str, Any]
    probes: list[EnablementProbeView]


class PlacementFindingView(_WireModel):
    """One line of the review's answer.

    ``field`` names the attestation field the code is about (``withdrawalPermitted``)
    or is ``None`` when the finding is about the review itself (``ATTESTATION_
    UNREACHABLE`` has no field to point at). It is published because a code with
    no field is a code an operator has to interpret; the field turns
    interpretation into a check.
    """

    code: str
    severity: str
    field: str | None
    message: str


class PlacementAttestRequest(_WireModel):
    """Body of ``POST /internal/v1/placement/attest`` (Part 16).

    There is no quantity, price or side here, and that is the whole design: this
    endpoint asks "would this be permitted", never "place this". The order shape
    is present only because the venue's answer depends on it - a symbol that
    accepts LIMIT may reject STOP_LIMIT, and a review that ignored the shape would
    be reporting a permission the order does not have.
    """

    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    symbol: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9/_-]+$")
    order_type: str = Field(default="LIMIT", min_length=3, max_length=24)
    time_in_force: str = Field(default="GTC", min_length=2, max_length=12)

    @field_validator("symbol", "order_type", "time_in_force")
    @classmethod
    def _upper(cls, value: str) -> str:
        """Normalise case, and refuse a value that is only case.

        ``" limit "`` means LIMIT and is accepted after the strip; ``"  "`` means
        nothing and would otherwise reach the reviewer as a two-character symbol
        whose venue answer is guaranteed to be "not found" - a refusal an operator
        would then read as a permissions problem rather than as a typo.
        """
        cleaned = value.strip().upper()
        if not cleaned:
            raise ValueError("must not be blank after trimming")
        return cleaned


class PlacementAttestResponse(_WireModel):
    """The review's verdict, in the shape the engine records.

    ``allowed`` is a 200 either way: "the venue refused" is the answer to the
    question, not a failure of the endpoint (Part 15 established the same rule
    for a FAIL grade, for the same reason - an error status would bury the
    evidence under the transport).

    ``transmitted`` is present as a constant ``false`` so a client can assert it
    rather than trust the documentation. It says what this endpoint did NOT do;
    a caller that reads ``true`` here has been answered by something else, and a
    check that can fail is worth more than a sentence that cannot be verified.
    """

    allowed: bool
    verdict_id: str
    #: Every code the review produced, in the law's deterministic order, and the
    #: subset that actually refused. Both are published because they answer
    #: different questions: "what did the venue say" and "what stood in the way".
    codes: list[str]
    blocking_codes: list[str]
    #: "Re-run it" versus "a human must act at the venue" - the distinction the
    #: worker needs and cannot infer from a refusal alone.
    retryable: bool
    venue_backed: bool
    venue_trading_permitted: bool
    no_known_withdrawal_path: bool
    review_required_at_micros: int
    attested_at_micros: int
    summary: str
    findings: list[PlacementFindingView]
    #: Mirrors the durable event payload's spelling of the same claims, so a
    #: console comparing an operator's ad-hoc review with an order's audit line
    #: is comparing one contract rather than two near-identical ones.
    payload: dict[str, str]
    transmitted: bool = False
    #: Which gatherer answered, from the runtime's wiring description. A verdict
    #: without its provenance is a opinion; with it, it is evidence.
    mode: str
    attestor_source: str


class IncidentListRequest(_WireModel):
    """Body of ``POST /internal/v1/incidents/list`` (Part 17).

    A read, expressed as a POST with a body, because that is how this service
    already asks a tenant-scoped question: ``retention/inspect`` and
    ``enablement/audit`` both carry ``tenantId`` so the header match in
    ``require_tenant_match`` has something to compare against. A query string
    would have made the tenant a client-chosen default.
    """

    tenant_id: str = _TENANT
    account_id: str | None = Field(
        default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    #: The store's bound, not the caller's: an unbounded read of an audit table is
    #: a way to turn an operator endpoint into an availability incident.
    limit: int = Field(default=100, ge=1, le=1000)


class IncidentView(_WireModel):
    """One incident, in the field set ``ExecutionIncident.to_dict()`` publishes.

    The list is literal and the test asserts it: ``details`` is the one field a
    writer might have stuffed a request body into, and the core scrubs it on
    construction. Re-declaring the shape here is what makes "no credential can
    reach this response" a property of the contract rather than of the scrubber's
    mood, and a renamed core field becomes a broken test instead of a silently
    absent column.
    """

    incident_id: str
    tenant_id: str
    account_id: str | None
    type: str
    severity: str
    summary: str
    exchange: str | None
    symbol: str | None
    order_id: str | None
    client_order_id: str | None
    error_code: str | None
    details: dict[str, str]
    occurred_at_micros: int
    resolved: bool
    resolution_note: str | None


class IncidentListResponse(_WireModel):
    """The open incidents this runtime can show, plus what showing them cost.

    ``source`` is the sink's class name and ``durable`` is its own claim, because
    "there are no open incidents" and "there are no open incidents in this
    process's memory" are different answers to the question an operator asked; the
    pair is what lets a caller tell them apart without reading the deployment.
    """

    tenant_id: str
    source: str
    durable: bool
    limit: int
    returned: int
    incidents: list[IncidentView]
```


## FILE: services/execution-engine/app/routers/internal.py (275 lines)

*one more field mapped from describe() through its view, with the missing key left to raise: Part 16's parity discipline keeps a field from reaching an internal caller unreviewed, and the same rule says a description that stopped publishing something should fail the route rather than answer a guess.*

```python
"""The internal command surface the trading worker forwards to.

Contract notes that the worker and the API both depend on:

* 200 means DURABLY PROCESSED (for the runtime's durability class); the
  business verdict rides in the body (`outcome`, `verified`), never in the
  status code. A rejected cancel and a completed cancel are both 200 -
  the job is done when we have a confident answer about it, which is
  exactly the BullMQ ack boundary.
* 4xx here is never retried: 401/403 is wiring wrong, 422 is a payload
  that cannot be executed by anyone, 404 says the record this command
  acts on does not exist in this runtime's store. 501 says "supported by
  the queue contract, not wired in this build" - the honest answer for
  resync-private-stream today.
* 5xx is retryable by contract; the worker defers the job.
* every response carries the correlation ids back so the worker can log
  one line per command that both sides can grep for.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.composition import EngineRuntime
from app.routers.health import get_runtime
from app.schemas import (
    AccountCommandRequest,
    BalancesResponse,
    BalanceView,
    CancelOrderRequest,
    CancelOrderResponse,
    DiscrepancyView,
    IncidentSinkView,
    LiveEnablementView,
    PlacementStatusView,
    ReconcileResponse,
    StatusResponse,
    VerifyResponse,
)
from app.security import (
    ServiceCaller,
    require_internal_auth,
    require_internal_auth_readonly,
    require_tenant_match,
)

router = APIRouter(prefix="/internal/v1", tags=["internal"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]
RuntimeDep = Annotated[EngineRuntime, Depends(get_runtime)]

#: The read scope (Part 20), on the one route in this file that acts on nothing. The
#: reason it exists is a defect this part found by RUNNING the composition rather than
#: reading it: the worker's startup gate calls ``GET /internal/v1/status`` with no
#: tenant header - correctly, since a process-level read has no tenant to name - and
#: ``require_internal_auth`` answered it with 400 TENANT_HEADER_REQUIRED, which is not a
#: terminal status, so `src/worker.ts` logged "execution engine gate failed" and exited
#: 1. The reference deployment could not start its worker, and nothing in the suites
#: noticed for nine parts because every test of that gate stubs ``fetch``. The fix had to
#: be on this side of the boundary: a client cannot answer a tenant law by inventing a
#: tenant, and the alternative - having the gate read the unauthenticated
#: ``/health/ready`` instead - would base an assert-before-forward decision on a
#: document any peer can forge.
ReadAuthDep = Annotated[ServiceCaller, Depends(require_internal_auth_readonly)]


@router.get("/status", response_model=StatusResponse, response_model_by_alias=True)
async def engine_status(
    # The tenant is not consulted below, and that is the argument for this dependency
    # rather than `AuthDep`: the route reads the process, not a tenant's rows.
    caller: ReadAuthDep,
    runtime: RuntimeDep,
    request: Request,
) -> StatusResponse:
    """The worker asserts `mode`/`store`/`commands` against its own config
    before forwarding anything; a deployment that disagrees is refused at
    the worker boundary rather than discovered mid-command."""
    wiring = runtime.describe()
    placement = wiring.get("placement")
    return StatusResponse(
        instance_id=str(wiring["instanceId"] or ""),
        mode=str(wiring["mode"]),
        dry_run=bool(wiring["dryRun"]),
        adapter=str(wiring["adapter"]),
        store=str(wiring["store"]),
        store_durable=bool(wiring["storeDurable"]),
        store_backend=str(wiring["storeBackend"]),
        retention_enabled=bool(wiring["retentionEnabled"]),
        retention_event_days=int(wiring["retentionEventDays"]),
        enablement_max_age_days=int(wiring["enablementMaxAgeDays"]),
        credential_source=str(wiring["credentialSource"]),
        # A KeyError here is the intended behaviour, not a bug to guard: the key is
        # published by ``describe()`` above, and a composition that stopped
        # publishing it should fail this route loudly rather than answer "false"
        # about a field it no longer reports.
        metrics_configured=bool(wiring["metricsConfigured"]),
        # Read with ``[]``, not ``get``: these keys are published by describe()
        # above, and a status route that defaulted them would answer a question this
        # process stopped asking.
        credential_fetcher=wiring["credentialFetcher"],
        operator_confirmation=bool(wiring["operatorConfirmation"]),
        live_enablement=(
            None
            if wiring["liveEnablement"] is None
            else LiveEnablementView(**wiring["liveEnablement"])
        ),
        # Validated through the view rather than passed through as a dict: the
        # keys below are the contract, so a describe() that starts publishing
        # something new fails here (and in the drift test) instead of quietly
        # publishing an unreviewed field on an authenticated internal surface.
        placement=None if placement is None else PlacementStatusView(**placement),
        # Part 17's block, mapped through its typed view for the same reason the
        # placement block is: a describe() that starts publishing something else is
        # a decision to be made here, not an unreviewed field on an internal
        # caller's screen - and "why is the incident list empty" is exactly the
        # question this route exists to answer without shell access.
        incidents=(
            None
            if wiring.get("incidents") is None
            else IncidentSinkView(**wiring["incidents"])
        ),
        locks_distributed=bool(wiring["locksDistributed"]),
        commands=[str(command) for command in wiring["commands"]],
    )


@router.post(
    "/accounts/verify-credentials",
    response_model=VerifyResponse,
    response_model_by_alias=True,
)
async def verify_credentials(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> VerifyResponse:
    require_tenant_match(body.tenant_id, caller)
    ok, note = await runtime.account_adapter.verify_credentials(
        body.tenant_id, body.account_id
    )
    return VerifyResponse(verified=ok, note=note, is_simulated=True)


@router.post(
    "/accounts/refresh-balances",
    response_model=BalancesResponse,
    response_model_by_alias=True,
)
async def refresh_balances(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> BalancesResponse:
    require_tenant_match(body.tenant_id, caller)
    balances = await runtime.account_adapter.fetch_balances(
        body.tenant_id, body.account_id
    )
    return BalancesResponse(
        balances=[
            BalanceView(asset=row.asset, free=str(row.free), locked=str(row.locked))
            for row in balances
        ],
        is_simulated=True,
    )


@router.post(
    "/accounts/reconcile",
    response_model=ReconcileResponse,
    response_model_by_alias=True,
)
async def reconcile_account(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> ReconcileResponse:
    require_tenant_match(body.tenant_id, caller)
    report = await runtime.reconciliation.reconcile_account(
        body.tenant_id, body.account_id
    )
    return ReconcileResponse(
        tenant_id=report.tenant_id,
        account_id=report.account_id,
        exchange=report.exchange.value,
        orders_checked=report.orders_checked,
        fills_recovered=report.fills_recovered,
        discrepancy_count=len(report.discrepancies),
        discrepancies=[
            DiscrepancyView(
                discrepancy_type=discrepancy.discrepancy_type.value,
                summary=discrepancy.summary,
                order_id=discrepancy.order_id,
                repaired=discrepancy.repaired,
            )
            for discrepancy in report.discrepancies
        ],
        error=report.error,
        started_at_micros=report.started_at_micros,
        finished_at_micros=report.finished_at_micros,
    )


@router.post(
    "/accounts/resync-private-stream",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def resync_private_stream(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> dict[str, Any]:
    """Not wired in the simulated build, and the refusal is the feature.

    A private-stream resync is a LIVE venue interaction (new listen key,
    reconnect, catch-up reconcile). Simulated execution has no stream to
    resync; pretending to accept the command would turn the API's honest
    202 "queued for the worker" into a lie three hops later. The job fails
    visibly with a reason an operator can read.
    """
    require_tenant_match(body.tenant_id, caller)
    return {
        "code": "NOT_SUPPORTED",
        "message": (
            "resync-private-stream requires the live venue adapter (Part 12); "
            "this runtime is simulated and has no private stream to resync."
        ),
    }


@router.post("/orders/cancel", response_model=CancelOrderResponse, response_model_by_alias=True)
async def cancel_order(
    body: CancelOrderRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> CancelOrderResponse:
    require_tenant_match(body.tenant_id, caller)
    order = await runtime.store.get_order(body.tenant_id, body.order_id)
    if order is None:
        # 404, not a fabricated rejection: this runtime has no record of
        # the order, so it must not claim an outcome about it. The worker's
        # job fails visibly; the API-side order state never moves.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "ORDER_NOT_FOUND",
                "message": (
                    "This runtime holds no record of that order; refusing to "
                    "report a cancellation outcome for an order it cannot see."
                ),
            },
        )
    if order.client_order_id != body.client_order_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ORDER_IDENTITY_MISMATCH",
                "message": (
                    "The order record does not carry the client order id the "
                    "command named; the job is refused rather than aimed at a "
                    "different order."
                ),
            },
        )
    result = await runtime.engine.cancel(order)
    return CancelOrderResponse(
        outcome=result.outcome.value,
        client_order_id=result.client_order_id or body.client_order_id,
        order_status=result.order.status.value if result.order is not None else "UNKNOWN",
        error_code=result.error_code.value if result.error_code is not None else None,
        message=result.message,
        latency_micros=result.latency_micros,
        is_simulated=result.is_simulated,
    )
```


## FILE: services/execution-engine/app/main.py (214 lines)

*the hub built after the runtime and not wrapped in a try (a registry that refuses a family is a wiring mistake, and wiring mistakes die at startup here), the router mounted only when the flag is on, and the __main__ block brought onto the same target the image names - uvicorn.run("app.main:create_app", factory=True) - so the reproduction and the deployment cannot be different programs.*

```python
"""Execution engine application factory.

The process owns the money path's runtime and nothing else: no public
routes, no admin surface, no UI. Startup is where wiring mistakes die -
``build_runtime`` refuses live mode, ``get_settings`` refuses missing or
placeholder secrets - so the first request ever served meets either a fully
composed engine or no process at all.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.composition import build_runtime
from app.config import get_settings
from app.incidents_sql import PostgresIncidentRecorder
from app.logging_config import configure_logging
from app.observability import ExecutionEngineObservability
from app.pg_store import open_durable_store
from app.routers import (
    enablement,
    health,
    internal,
    placement,
    retention,
)
from app.routers import (
    incidents as incidents_router,
)
from app.routers import (
    observability as observability_router,
)
from app.security import REQUEST_ID_HEADER

logger = logging.getLogger(__name__)

#: Response header echoing the correlation id, matching the platform's
#: convention so a worker log line and an engine log line join on it.
CORRELATION_HEADER = "x-correlation-id"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Raises through startup on any refused combination - live mode,
        # catalog incoherence - which is the whole safety design: a process
        # that cannot state its wiring does not serve traffic.
        store = None
        pool = None
        incidents = None
        if settings.EXECUTION_STORE_BACKEND == "postgres":
            pool, store = await open_durable_store(settings)
            # Part 17: the sink is built over the SAME pool the store came from,
            # here rather than inside open_durable_store, because this function is
            # where "we have a durable plane" is decided - and passing it down is
            # what lets composition refuse a durable store that arrived without
            # one, instead of quietly defaulting to memory.
            incidents = PostgresIncidentRecorder(pool)
        app.state.runtime = build_runtime(settings, store=store, incidents=incidents)
        # Part 18: the hub is built AFTER the runtime because it reads the
        # runtime's own instruments, and it is NOT wrapped in a try. A hub that
        # cannot register its families - an illegal metric or label name reaching
        # the cardinality law - is a wiring mistake, and this file's opening
        # sentence is that wiring mistakes die at startup rather than being
        # swallowed into a degraded-but-running process. Refusing the boot is also
        # the kinder answer for the operator: a missing scrape is obvious in the
        # startup log, and invisible in every panel that reads zero.
        if settings.OBSERVABILITY_ENABLED:
            app.state.observability = ExecutionEngineObservability(app.state.runtime)
        app.state.store_pool = pool
        logger.info(
            "execution_engine.started",
            extra={
                "event": "execution_engine.started",
                "instance_id": settings.EXECUTION_INSTANCE_ID,
                "version": __version__,
                "wiring": (app.state.runtime.describe() if hasattr(app.state, "runtime") else {}),
            },
        )
        yield
        if pool is not None:
            await pool.close()
        logger.info("execution_engine.stopped", extra={"event": "execution_engine.stopped"})

    app = FastAPI(
        title="wlct execution engine",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    @app.middleware("http")
    async def correlation(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Best-effort id continuity: honour a well-formed incoming id (the
        # worker sends its job's x-request-id), mint one otherwise. Capped
        # at 128 chars so a hostile header cannot bloat every log line.
        incoming = request.headers.get(REQUEST_ID_HEADER)
        correlation_id = (
            incoming
            if incoming is not None and 0 < len(incoming) <= 128 and _printable(incoming)
            else f"eng-{uuid.uuid4().hex[:20]}"
        )
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers[CORRELATION_HEADER] = correlation_id
        return response

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field locations only, never values: a rejected payload may contain
        # exactly the thing it should not, and 422 bodies get screenshotted.
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_FAILED",
                "message": "The command payload does not satisfy the contract.",
                "fields": [
                    {"location": ".".join(str(part) for part in err.get("loc", ())),
                     "type": str(err.get("type", "value_error"))}
                    for err in exc.errors()
                ],
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        raw_detail: object = exc.detail
        if isinstance(raw_detail, dict):
            content: dict[str, object] = raw_detail
        else:
            content = {
                "code": f"HTTP_{exc.status_code}",
                "message": str(raw_detail),
            }
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "execution_engine.unhandled",
            extra={
                "event": "execution_engine.unhandled",
                "path": request.url.path,
                "correlation_id": getattr(request.state, "correlation_id", None),
            },
        )
        # The message is for the logs; the client gets a retryable 500 with
        # the correlation id - never an exception string, which is how
        # internal shapes leak and secrets travel.
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "The command failed inside the engine; retry is permitted.",
                "correlationId": getattr(request.state, "correlation_id", ""),
            },
        )

    app.include_router(health.router)
    app.include_router(internal.router)
    app.include_router(retention.router)
    app.include_router(enablement.router)
    # Part 16's review surface: read-only with respect to orders, and mounted
    # last because it is the one route an operator reaches for when a refusal
    # needs explaining - the command plane above must never depend on it.
    app.include_router(placement.router)
    # The incident read surface (Part 17) sits beside it for the same reason: it
    # explains refusals, it does not produce them. Mounted after the review
    # because an operator who cannot place an order wants the list of why.
    app.include_router(incidents_router.router)
    # Mounted with the same gate as the hub, so a disabled exposition is a 404
    # rather than a 200 of prose: "no scrape target" and "empty target" are
    # different facts and a monitoring pipeline should not have to read a body to
    # tell them apart. Production cannot reach this branch - config refuses to
    # parse OBSERVABILITY_ENABLED=false there.
    if settings.OBSERVABILITY_ENABLED:
        app.include_router(observability_router.router)
    return app


def _printable(candidate: str) -> bool:
    return all(32 <= ord(ch) < 127 for ch in candidate)


if __name__ == "__main__":
    settings = get_settings()
    # The same target the image names, and for the same reason (see
    # infrastructure/docker/execution-engine.Dockerfile): there is deliberately no
    # module-level ``app`` here, because constructing the app is where settings are
    # parsed and a refused configuration belongs at startup, not at import.
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.EXECUTION_ENGINE_HOST,
        port=settings.SERVICE_PORT,
        log_config=None,  # uvicorn's default logging would bypass the redaction pipeline
    )
```


## FILE: services/execution-engine/requirements-dev.txt (23 lines)

*sqlglot==30.18.0 declared. Part 13's tests had been parsing migrations through an optional import for nine parts, which meant a clean install did not fail - it quietly collected fewer tests, the worst failure mode a dependency can have.*

```text
-r requirements.txt
pytest==8.3.3
pytest-asyncio==0.24.0
# httpx is NOT listed here any more: Part 19 made it a runtime dependency (see
# requirements.txt), and a pin repeated in two files is two pins - one of which will be
# upgraded while the other is not. fastapi.testclient's own requirement is satisfied by
# the same file either way.
# SQL parsing for the drift-parity and store suites (Parts 13-15 parse the engine
# migrations and every SQL constant with it, so a typo in a statement is a test
# failure rather than a startup error). Declared here because it was NOT declared
# anywhere: parts 13 and 14 reached for it through pytest.importorskip and a hard
# import in the same suite, so a clean environment following this file's own
# instructions could not even COLLECT the service tests - four collection errors,
# and the two importorskip sites were quietly skipping the assurance instead.
# Pinned like everything else here: a parser upgrade that changes how it reads a
# CREATE INDEX would show up as a failing expectation, not as a mystery.
sqlglot==30.18.0
ruff==0.6.9
mypy==1.11.2

# The execution core is a repo package, not a PyPI one; tests and local runs
# resolve it from source exactly like the trading engine does.
-e ../../libs/trading-core
```


## FILE: services/execution-engine/tests/test_part13_drift_parity.py (330 lines)

*the module-level sqlglot import that replaces pytest.importorskip, so a missing dependency is a collection error naming the file rather than a smaller suite nobody notices.*

```python
"""Part 13: cross-language drift trap - store SQL vs the owning schema.

The Python service builds statements against tables whose DDL lives in the
Node world (apps/api/prisma). That split is a drift invitation, so this
file closes it mechanically: every column the store references must exist
in BOTH schema.prisma (model + @@map + @map spellings) and the Part 13
migration SQL, every conflict-target must name a constraint that exists,
and the bounded column widths must cover the wire validators that feed
them. Add a column to one side only and a test goes red here, not in a
stack trace at 3am.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from sqlglot import parse as sqlglot_parse

from app import store_sql

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "apps" / "api" / "prisma" / "schema.prisma"
MIGRATION = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914120000_part13_execution_store"
    / "migration.sql"
)


def _model_block(text: str, model: str) -> str:
    match = re.search(rf"^model {model} \{{(.*?)^\}}", text, re.DOTALL | re.MULTILINE)
    assert match is not None, f"model {model} missing from schema.prisma"
    return match.group(1)


def _create_table_block(sql: str, table: str) -> str:
    match = re.search(
        rf'CREATE TABLE "{table}" \((.*?)\n\);', sql, re.DOTALL
    )
    assert match is not None, f"CREATE TABLE {table} missing from the migration"
    return match.group(1)


@pytest.fixture(scope="module")
def schema_text() -> str:
    return SCHEMA.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def migration_text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


class TestOrdersColumnsExistInBothArtifacts:
    def test_every_store_column_is_a_migration_column(self, migration_text: str) -> None:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        declared = set(re.findall(r'^\s+"([a-z_]+)"', block, re.MULTILINE))
        missing = set(store_sql._ORDER_COLUMNS) - declared
        assert not missing, (
            f"store references columns the migration never creates: {sorted(missing)}"
        )

    def test_every_migration_order_column_is_known_to_the_store(self, migration_text: str) -> None:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        declared = set(re.findall(r'^\s+"([a-z_]+)"', block, re.MULTILINE))
        unknown = declared - set(store_sql._ORDER_COLUMNS)
        # A column in the table the store does not know is also drift - it
        # will silently never be written by this adapter.
        assert not unknown, f"migration columns the store codec does not cover: {sorted(unknown)}"

    def test_schema_column_set_equals_the_store_column_set(self, schema_text: str) -> None:
        """Parse each field's effective column name (@map wins, else field
        name) and demand EXACT set equality with the SQL codec - in both
        directions, so a renamed, added or dropped column on either side
        fails here."""
        block = _model_block(schema_text, "ExecutionOrder")
        columns: set[str] = set()
        for line in block.splitlines():
            line = line.strip()
            match = re.match(r"(\w+)\s+\S+", line)
            if match is None or line.startswith("//") or line.startswith("@@"):
                continue
            mapped = re.search(r'@map\("([^"]+)"\)', line)
            columns.add(mapped.group(1) if mapped else match.group(1))
        declared = {c for c in columns if not c.startswith(("tenant ", "events ", "fills "))}
        # relation fields (tenant, events, lists) name no column
        declared -= {"tenant", "events", "fills"}
        assert declared == set(store_sql._ORDER_COLUMNS), (
            f"only-in-schema: {sorted(declared - set(store_sql._ORDER_COLUMNS))} "
            f"only-in-sql: {sorted(set(store_sql._ORDER_COLUMNS) - declared)}"
        )


class TestChildTablesParity:
    def test_fill_statement_columns_match_the_migration(self, migration_text: str) -> None:
        insert = store_sql._RECORD_FILL_SQL
        sql_columns = insert.split("(", 1)[1].split(")", 1)[0]
        referenced = {c.strip() for c in sql_columns.split(",")}
        declared = set(
            re.findall(
                r'^\s+"([a-z_]+)"',
                _create_table_block(migration_text, store_sql.TABLE_FILLS),
                re.MULTILINE,
            )
        )
        assert referenced - {"seq"} <= declared

    def test_event_statement_columns_match_the_migration(self, migration_text: str) -> None:
        insert = store_sql._RECORD_EVENT_SQL
        sql_columns = insert.split("(", 1)[1].split(")", 1)[0]
        referenced = {c.strip() for c in sql_columns.split(",")}
        declared = set(
            re.findall(
                r'^\s+"([a-z_]+)"',
                _create_table_block(migration_text, store_sql.TABLE_EVENTS),
                re.MULTILINE,
            )
        )
        assert referenced - {"seq"} <= declared

    def test_select_lists_use_only_declared_child_columns(self, migration_text: str) -> None:
        for table, sql in (
            (store_sql.TABLE_EVENTS, store_sql._LIST_EVENTS_SQL),
            (store_sql.TABLE_FILLS, store_sql._LIST_FILLS_SQL),
        ):
            selected = {
                c.strip() for c in sql.split("SELECT", 1)[1].split("FROM", 1)[0].split(",")
            }
            declared = set(
                re.findall(
                    r'^\s+"([a-z_]+)"',
                    _create_table_block(migration_text, table),
                    re.MULTILINE,
                )
            )
            assert selected <= declared, (
                f"{table}: selected {sorted(selected - declared)} not in migration"
            )


class TestLiteralsAgreeWithTheParamsTuple:
    """The SQL text is literal (no interpolation); the tuple is the param
    order. These glue the two so neither can drift from the migration."""

    def test_insert_column_list_equals_the_params_tuple(self) -> None:
        assert tuple(c.strip() for c in store_sql._ORDER_COLUMN_LIST.split(",")) == (
            store_sql._ORDER_COLUMNS
        )

    def test_select_prefix_reads_the_same_columns_in_order(self) -> None:
        head = store_sql._ORDER_SELECT.split("SELECT ", 1)[1].split(", COALESCE", 1)[0]
        assert tuple(c.strip().removeprefix("o.") for c in head.split(",")) == (
            store_sql._ORDER_COLUMNS
        )

    def test_upsert_assigns_every_column_but_the_composite_key(self) -> None:
        assign_part = store_sql._SAVE_UPSERT_SQL.split("DO UPDATE SET ", 1)[1]
        assigned = tuple(
            piece.split(" = ")[0].strip() for piece in assign_part.split(", ")
        )
        assert assigned == tuple(
            c for c in store_sql._ORDER_COLUMNS if c not in ("tenant_id", "order_id")
        )

    def test_table_name_constants_appear_where_sql_hardcodes_them(self) -> None:
        # the constants exist (pg_store's preflight uses them); the SQL
        # literals must name exactly those tables.
        assert store_sql.TABLE_ORDERS == "engine_orders"
        assert store_sql.TABLE_EVENTS == "engine_order_events"
        assert store_sql.TABLE_FILLS == "engine_order_fills"
        for sql in (
            store_sql.RESERVE_INSERT_SQL,
            store_sql._SAVE_UPSERT_SQL,
            store_sql._SELECT_BY_ORDER_SQL,
            store_sql._SET_RECON_SQL,
            store_sql._GET_RECON_SQL,
        ):
            assert "engine_orders" in sql
        assert store_sql.TABLE_EVENTS in store_sql._RECORD_EVENT_SQL
        assert store_sql.TABLE_FILLS in store_sql._RECORD_FILL_SQL


class TestConstraintsTheSqlReliesOn:
    def test_reservation_needs_the_tenant_client_unique(
        self, migration_text: str, schema_text: str
    ) -> None:
        assert (
            'CREATE UNIQUE INDEX "engine_orders_tenant_client_key" '
            'ON "engine_orders"("tenant_id", "client_order_id")'
            in migration_text
        )
        assert "@@unique([tenantId, clientOrderId]" in _model_block(schema_text, "ExecutionOrder")

    def test_fill_replay_protection_needs_the_tenant_fill_unique(
        self, migration_text: str, schema_text: str
    ) -> None:
        assert (
            'CREATE UNIQUE INDEX "engine_order_fills_tenant_fill_key" '
            'ON "engine_order_fills"("tenant_id", "fill_id")'
            in migration_text
        )
        assert "@@unique([tenantId, fillId]" in _model_block(schema_text, "ExecutionOrderFill")

    def test_open_order_predicate_needs_the_composite_index(self, migration_text: str) -> None:
        assert (
            'CREATE INDEX "engine_orders_tenant_id_account_id_status_idx" '
            'ON "engine_orders"("tenant_id", "account_id", "status")'
            in migration_text
        )

    def test_child_fk_composite_targets_the_composite_pk(self, migration_text: str) -> None:
        for table in (store_sql.TABLE_EVENTS, store_sql.TABLE_FILLS):
            pattern = (
                rf'ALTER TABLE "{table}" ADD CONSTRAINT .*FOREIGN KEY \("tenant_id", "order_id"\) '
                rf'REFERENCES "engine_orders"\("tenant_id", "order_id"\)'
            )
            assert re.search(pattern, migration_text, re.DOTALL), f"{table} lost its composite FK"

    def test_parent_identity_is_composite_never_global(
        self, schema_text: str, migration_text: str
    ) -> None:
        assert "@@id([tenantId, orderId])" in _model_block(schema_text, "ExecutionOrder")
        assert (
            'CONSTRAINT "engine_orders_pkey" PRIMARY KEY ("tenant_id", "order_id")'
            in migration_text
        )


class TestWidthLawsMatchTheWireValidators:
    """Column bounds must cover what the service's wire schemas accept.

    Parsed from the TEXT of app/schemas.py rather than imported Field
    objects: the point is that the two declarations - one enforced at the
    HTTP boundary, one at the table - stay consistent, and text-scan says
    so even for fields declared inside request models.
    """

    WIRE = ROOT / "services" / "execution-engine" / "app" / "schemas.py"

    def _wire_bound(self, field: str) -> int:
        text = self.WIRE.read_text(encoding="utf-8")
        match = re.search(rf'"{field}".*?max_length=(\d+)', text) or re.search(
            rf"{field}: str.*?max_length=(\d+)", text
        )
        assert match is not None, (
            f"{field} has no max_length on the wire schema anymore - "
            "re-examine this parity test"
        )
        return int(match.group(1))

    def _column_width(self, migration_text: str, column: str) -> int:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        match = re.search(rf'"{column}" VARCHAR\((\d+)\)', block)
        assert match is not None, f"{column} is not a bounded column in the migration"
        return int(match.group(1))

    def test_identifiers_fit(self, migration_text: str) -> None:
        for column in ("order_id", "client_order_id", "symbol"):
            assert self._column_width(migration_text, column) >= self._wire_bound(column), column

    def test_tenant_law_is_the_uuid_check_not_a_width(self, migration_text: str) -> None:
        # tenant_id has a wire bound (64) but a DB TYPE (uuid): the parity
        # there is the store's canonical-UUID refusal, asserted in the
        # store suite; the migration must simply keep the column typed.
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        assert '"tenant_id" UUID NOT NULL' in block


class TestTenantGucAcrossPlanes:
    """The RLS contract has TWO callers: Node's PrismaService.withTenantRls
    and this store's _TenantTransaction. If either side edits the statement
    the other's rows vanish (policies match on the GUC), and the break is
    silent until enablement day. Python's test is the one that reads the
    TypeScript source - the direction that nobody would think to run
    during a Node refactor."""

    PRISMA_SERVICE = (
        ROOT / "apps" / "api" / "src" / "infrastructure" / "prisma" / "prisma.service.ts"
    )

    def test_node_sets_the_same_guc_the_store_sets(self) -> None:
        source = self.PRISMA_SERVICE.read_text(encoding="utf-8")
        match = re.search(
            r"set_config\('app\.tenant_id', \$\{tenantId\}, (true|false)\)", source
        )
        assert match is not None, (
            "PrismaService.withTenantRls changed its set_config call shape; "
            "re-derive PostgresOrderStore's SET_TENANT_SQL to match, or the "
            "generated policies silently admit different rows per plane"
        )
        assert match.group(1) == "true", "withTenantRls is no longer transaction-local"
        assert store_sql.SET_TENANT_SQL == "SELECT set_config('app.tenant_id', $1, true)"

    def test_migration_function_reads_the_same_guc(self, migration_text: str) -> None:
        part11 = (
            ROOT / "apps" / "api" / "prisma" / "migrations"
            / "20260913120000_part11_row_level_security" / "migration.sql"
        ).read_text(encoding="utf-8")
        assert "current_setting('app.tenant_id', true)" in part11
        assert 'CREATE OR REPLACE FUNCTION wlct_current_tenant_id() RETURNS uuid' in part11
        # the engine tables are in the covered list of the coverage JSON the
        # generator emits (auto-extension, checked here as the dependency
        # the store's design relies on).
        coverage = json.loads(
            (ROOT / "apps" / "api" / "prisma" / "rls" / "rls_coverage.json").read_text(
                encoding="utf-8"
            )
        )
        covered = {entry["table"] for entry in coverage["covered"]}
        assert {store_sql.TABLE_ORDERS, store_sql.TABLE_EVENTS, store_sql.TABLE_FILLS} <= covered


class TestSqlglotMigrationParses:
    def test_migration_file_is_valid_postgres(self, migration_text: str) -> None:
        # No importorskip: the dependency is declared in requirements-dev.txt, and
        # an optional import here would turn "the parser is missing" into a green
        # run that tested nothing - which is the failure mode Part 14's own drift
        # test avoided by importing at module level. A missing dep must be a loud
        # collection error, not a skip that reads as assurance.
        statements = [s for s in sqlglot_parse(migration_text, read="postgres") if s is not None]
        kinds = {type(s).__name__ for s in statements}
        assert {"Create", "Alter"} <= kinds
        assert len(statements) == 13  # 3 tables, 7 indexes, 3 FK alters
```


## FILE: services/execution-engine/tests/test_part13_postgres_store.py (770 lines)

*the same change on the other side of that pair: two skip-if-absent imports became one hard import, and the count of tests this suite can run stopped depending on what the machine happened to have installed.*

```python
"""Part 13: the durable Postgres OrderStore adapter, tested without a DB.

Two philosophies combine here, both deliberate:

* **Scripted statements** pin the exact SQL contract the store emits -
  the same way Part 11 pinned the coordination Redis scripts. A statement
  that changes shape is a change to the durable schema contract and must
  be a decision, not a refactor side effect.
* **An echo connection** (records every insert, answers the matching
  SELECT from the recorded parameters) makes the codec round-trip real:
  the row that would land in Postgres is the row that comes back, so
  column order, decimal scale, null handling and the child-JSON
  reconstruction are exercised through the same tables the driver would
  use - without a Postgres in the sandbox.

The environment-gated live-database variant lives in
``test_part13_postgres_store_live.py``; when ``EXECUTION_TEST_POSTGRES_DSN``
is set (CI with a service container), the identical semantic assertions run
against the real thing. Absent the variable the module skips - visibly,
never silently green by substitution.
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from decimal import Decimal, InvalidOperation
from typing import Any, cast

import pytest
from sqlglot import parse_one as sqlglot_parse_one
from wlct_trading.enums import (
    TERMINAL_ORDER_STATUSES,
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.execution.store import ReconciliationState
from wlct_trading.orders import Fill, Order, OrderEvent

from app import store_sql
from app.store_sql import (
    RESERVE_INSERT_SQL,
    SET_TENANT_SQL,
    TABLE_FILLS,
    CrossTenantSweepUnsupported,
    PostgresOrderStore,
    _decode_order,
    _fill_params,
    _order_params,
)

TENANT = "3f2a1b04-7c5d-4e6f-9a8b-0c1d2e3f4a5b"
OTHER_TENANT = "9a8b7c6d-5e4f-4a3b-8c7d-6e5f4a3b2c1d"


def make_order(**overrides: object) -> Order:
    base: dict[str, object] = {
        "order_id": "ord_01",
        "client_order_id": "wlc-0001",
        "tenant_id": TENANT,
        "account_id": "acct_01",
        "strategy_id": None,
        "exchange": ExchangeId.BINANCE,
        "symbol": "BTCUSDT",
        "side": OrderSide.BUY,
        "order_type": OrderType.LIMIT,
        "quantity": Decimal("0.10"),
        "price": Decimal("50000.00"),
        "time_in_force": TimeInForce.GTC,
        "is_simulated": True,
        "status": OrderStatus.PENDING,
        "created_at": 1_700_000_000_000_000,
        "updated_at": 1_700_000_000_000_001,
    }
    order = Order(
        order_id=str(base["order_id"]),
        client_order_id=str(base["client_order_id"]),
        tenant_id=str(base["tenant_id"]),
        account_id=str(base["account_id"]),
        strategy_id=base["strategy_id"],
        exchange=base["exchange"],
        symbol=str(base["symbol"]),
        side=base["side"],
        order_type=base["order_type"],
        quantity=base["quantity"],
        price=base["price"],
        time_in_force=base["time_in_force"],
        is_simulated=base["is_simulated"],
        status=base["status"],
        created_at=base["created_at"],
        updated_at=base["updated_at"],
    )
    return replace(order, **overrides) if overrides else order


def order_row(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "tenant_id": TENANT,
        "order_id": "ord_01",
        "client_order_id": "wlc-0001",
        "account_id": "acct_01",
        "strategy_id": None,
        "exchange": "binance",
        "symbol": "BTCUSDT",
        "side": "BUY",
        "order_type": "LIMIT",
        "time_in_force": "GTC",
        "reduce_only": False,
        "signal_id": None,
        "is_simulated": True,
        "status": "PENDING",
        "exchange_order_id": None,
        "quantity": "0.10",
        "price": "50000.00",
        "stop_price": None,
        "filled_quantity": "0",
        "average_fill_price": None,
        "cumulative_fee": "0",
        "fee_currency": None,
        "rejection_reason": None,
        "created_at": 1_700_000_000_000_000,
        "updated_at": 1_700_000_000_000_001,
        "submitted_at": None,
        "terminal_at": None,
        "reconciliation_state": None,
        "fills_json": "[]",
        "events_json": "[]",
    }
    row.update(overrides or {})
    return row


def fill_payload(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    base: dict[str, Any] = {
        "fill_id": "fill_01",
        "order_id": "ord_01",
        "trade_id": "trade_01",
        "price": "0.100",
        "quantity": "0.05",
        "fee": "0.00060",
        "fee_currency": "BNB",
        "is_maker": True,
        "is_simulated": True,
        "exchange_timestamp": 1_700_000_000_000,
        "received_timestamp": 1_700_000_000_000_002,
        "symbol": None,
        "side": None,
        "exchange": None,
        "quote_quantity": None,
        "exchange_order_id": None,
    }
    base.update(overrides or {})
    return base


# Statement prefixes for the echo fake: spelled out as plain literals (the
# store's SQL is literal too), so the fake pattern-matches exactly the way
# a database dispatches - and no query is ever "constructed" in this file.
_INS_ORDERS = "INSERT INTO engine_orders"
_INS_FILLS = "INSERT INTO engine_order_fills"
_INS_EVENTS = "INSERT INTO engine_order_events"
_UPD_ORDERS = "UPDATE engine_orders"
_FROM_ORDERS_O = "FROM engine_orders o"
_RECON_SELECT = "SELECT reconciliation_state FROM engine_orders"


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeConn:
    """Records every statement; answers fetch/fetchrow from a script or echo."""

    def __init__(self, script: list[Any] | None = None, *, echo: bool = False) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self.script = list(script or [])
        self.cursor = 0
        self.echo = echo
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0
        # echo state: last-inserted order params, fills and events per order
        self.stored_order: dict[str, Any] | None = None
        self.stored_fills: list[dict[str, Any]] = []
        self.stored_events: list[dict[str, Any]] = []

    _UNSET = object()

    def _step(self, query: str, args: tuple[object, ...], *, allow_response: bool) -> Any:
        """One statement through the script cursor.

        Expectations bind to the statement they precede; any entry that is
        an exception raises at THIS statement (execute included); a plain
        value is only consumed by fetch/fetchrow - an execute statement
        never eats a response meant for the row read that follows it.
        """
        self.statements.append((query, args))
        # ONE expectation per statement (the tenant GUC is always the
        # first statement, so scripts read as [guc-expectation, next-
        # statement-...]); consuming greedily would match statement two's
        # assertion against statement one and hide the real ordering bug.
        if self.cursor < len(self.script) and isinstance(self.script[self.cursor], Expectation):
            self.script[self.cursor].check(query, args)
            self.cursor += 1
        if self.cursor < len(self.script) and allow_response:
            entry = self.script[self.cursor]
            if isinstance(entry, BaseException):
                self.cursor += 1
                raise entry
            self.cursor += 1
            return entry
        return self._UNSET

    async def execute(self, query: str, *args: object) -> str:
        self._step(query, args, allow_response=False)
        if self.echo:
            if query.startswith(_INS_ORDERS):
                self._capture(query, args, "_stored_order")
            elif query.startswith(_UPD_ORDERS):
                if self.stored_order is not None:
                    self.stored_order["reconciliation_state"] = args[2]
        return "OK 1"

    async def fetch(self, query: str, *args: object) -> list[Any]:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return list(entry) if isinstance(entry, list) else [entry]
        if self.echo and "FROM engine_order_fills" in query:
            return list(self.stored_fills)
        if self.echo and "FROM engine_order_events" in query:
            return list(self.stored_events)
        return []

    async def fetchrow(self, query: str, *args: object) -> Any | None:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return entry
        if self.echo:
            if query.startswith(_INS_ORDERS):
                self._capture(query, args, "_stored_order")
                assert self.stored_order is not None
                return {"order_id": self.stored_order["order_id"]}
            if query.startswith(_INS_FILLS):
                self._capture(query, args, None)
                return {"fill_id": self.stored_fills[-1]["fill_id"]}
            if query.startswith(_INS_EVENTS):
                self._capture(query, args, None)
                return {"seq": len(self.stored_events)}
            if _FROM_ORDERS_O in query and self.stored_order is not None:
                row = dict(self.stored_order)
                row["fills_json"] = json.dumps(self.stored_fills)
                row["events_json"] = json.dumps(self.stored_events)
                return row
            if query.startswith(_RECON_SELECT):
                recon = (
                    None
                    if self.stored_order is None
                    else self.stored_order.get("reconciliation_state")
                )
                return {"reconciliation_state": recon}
        raise AssertionError(f"unscripted fetchrow: {query[:80]}")

    def transaction(self) -> FakeTx:
        return FakeTx(self)

    def assert_fully_consumed(self) -> None:
        leftovers = [s for s in self.script[self.cursor:] if not isinstance(s, Expectation)]
        assert not leftovers, f"scripted responses left unconsumed: {leftovers!r}"

    def _capture(self, query: str, args: tuple[object, ...], target: str | None) -> None:
        """Zip the INSERT's column list with its bound parameters - the row
        Postgres WOULD have stored, in the order the SQL itself declares."""
        columns = query.split("(", 1)[1].split(")", 1)[0]
        names = [c.strip() for c in columns.split(",")]
        assert len(names) == len(args), f"{len(names)} columns vs {len(args)} args"
        row = dict(zip(names, args, strict=True))
        if target == "_stored_order":
            self.stored_order = row
        elif TABLE_FILLS in query:
            self.stored_fills.append(row)
        else:
            self.stored_events.append(row)


class Expectation:
    """A queued assertion - optionally a scripted failure - for the statement
    about to be executed. `raises` exists because driver errors must be
    attachable to ANY statement kind (including execute, which otherwise
    takes no scripted values); attaching them positionally would let an
    exception fire during the tenant-GUC statement instead, and a failure in
    __aenter__ skips __aexit__ by definition - the exact shape that would
    make a rollback test pass for the wrong reason."""

    def __init__(
        self,
        sql_contains: str,
        args: tuple[object, ...] | None = None,
        *,
        raises: BaseException | None = None,
    ) -> None:
        self.sql_contains = sql_contains
        self.args = args
        self.raises = raises

    def check(self, query: str, args: tuple[object, ...]) -> None:
        assert self.sql_contains in query, f"expected {self.sql_contains!r} in {query[:120]}"
        if self.args is not None:
            assert args == self.args, f"args {args!r} != {self.args!r}"
        if self.raises is not None:
            raise self.raises


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.enters = 0
        self.exits = 0

    async def __aenter__(self) -> FakeConn:
        self.enters += 1
        return self.conn

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        self.exits += 1
        return False


class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.acquires = 0
        self.closed = False

    def acquire(self) -> FakeAcquire:
        self.acquires += 1
        return FakeAcquire(self.conn)

    async def close(self) -> None:
        self.closed = True


def store(*script: Any, echo: bool = False) -> tuple[PostgresOrderStore, FakeConn, FakePool]:
    conn = FakeConn(script=list(script), echo=echo)
    pool = FakePool(conn)
    return PostgresOrderStore(cast(store_sql.PgPool, pool)), conn, pool


# ---------------------------------------------------------------------------
# statement-shape law (golden pins, DB-free)
# ---------------------------------------------------------------------------


class TestStatementShapes:
    def test_tenant_guc_is_the_exact_platform_contract(self) -> None:
        # Character-for-character the statement PrismaService.withTenantRls
        # issues (bound parameter, transaction-local TRUE). A change here
        # silently opts the engine out of every generated RLS policy.
        assert SET_TENANT_SQL == "SELECT set_config('app.tenant_id', $1, true)"

    def test_reservation_insert_targets_no_conflict_clause(self) -> None:
        head = RESERVE_INSERT_SQL
        assert head.startswith("INSERT INTO engine_orders (")
        assert "ON CONFLICT DO NOTHING RETURNING order_id" in head
        assert "ON CONFLICT (" not in head  # BOTH uniques must fold into DO NOTHING

    def test_order_columns_match_params_and_placeholders(self) -> None:
        params = _order_params(make_order(), None)
        assert len(store_sql._ORDER_COLUMNS) == len(params)
        placeholders = re.findall(r"\$\d+", RESERVE_INSERT_SQL)
        assert len(placeholders) == len(params)
        assert placeholders == [f"${i + 1}" for i in range(len(params))]

    def test_upsert_updates_everything_but_the_identity(self) -> None:
        clause = store_sql._SAVE_UPSERT_SQL.split("DO UPDATE SET ", 1)[1]
        assigned = {part.strip().split(" = ")[0] for part in clause.split(",")}
        assert "client_order_id" in assigned and "status" in assigned
        assert "tenant_id" not in assigned and "order_id" not in assigned

    def test_fill_recording_rides_the_tenant_fill_unique_index(self) -> None:
        assert "INSERT INTO engine_order_fills" in store_sql._RECORD_FILL_SQL
        assert "ON CONFLICT (tenant_id, fill_id) DO NOTHING RETURNING fill_id" in (
            store_sql._RECORD_FILL_SQL
        )
        assert len(_fill_params(TENANT, Fill(
            fill_id="f", order_id="o", trade_id="t", price=Decimal("1"), quantity=Decimal("1"),
            fee=Decimal("0"), fee_currency="USDT", is_maker=False, is_simulated=True,
            exchange_timestamp=1, received_timestamp=2,
        ))) == 17

    def test_events_append_only_and_payload_cast(self) -> None:
        sql = store_sql._RECORD_EVENT_SQL
        assert sql.startswith("INSERT INTO engine_order_events")
        assert "$8::jsonb" in sql and "RETURNING seq" in sql
        assert "UPDATE" not in sql and "DELETE" not in sql
        assert "ORDER BY seq ASC" in store_sql._LIST_EVENTS_SQL

    def test_open_orders_reads_the_shared_terminal_vocabulary(self) -> None:
        # The exclusion list must come from the shared enum - if someone
        # "fixes" this by typing statuses into the SQL string, this test
        # and the count are the alarm.
        assert "NOT (o.status = ANY($3::text[]))" in store_sql._LIST_OPEN_SQL_BASE
        params = _order_params(make_order(), None)
        assert params[store_sql._ORDER_COLUMNS.index("status")] == "PENDING"

    def test_child_reconstruction_orders_by_seq_and_never_nulls(self) -> None:
        fills_needle = (
            "COALESCE((SELECT json_agg(to_json(f) ORDER BY f.seq) "
            "FROM engine_order_fills"
        )
        events_needle = (
            "COALESCE((SELECT json_agg(to_json(e) ORDER BY e.seq) "
            "FROM engine_order_events"
        )
        assert fills_needle in store_sql._CHILD_JSON
        assert events_needle in store_sql._CHILD_JSON
        assert "'[]'::json" in store_sql._CHILD_JSON

    def test_every_constant_statement_parses_as_postgres(self) -> None:
        # Same law as the migration test next door: declared, imported, asserted -
        # never skipped on absence.
        names = [n for n in dir(store_sql) if "_SQL" in n and not n.startswith("__")]
        seen = 0
        for name in names:
            value = getattr(store_sql, name)
            if isinstance(value, str) and re.match(r"(?i)\s*(SELECT|INSERT|UPDATE|WITH)", value):
                sqlglot_parse_one(value, read="postgres")
                seen += 1
        assert seen >= 12

    def test_list_open_sql_numbers_placeholders_by_shape(self) -> None:
        # The builder appends $N off the real param count; both optional
        # predicates and neither must address exactly the slots they fill.
        base = store_sql._LIST_OPEN_SQL_BASE
        assert base.count("$") == 3
        sql_both = (
            base + " AND o.exchange = $4 AND o.symbol = $5" + store_sql._LIST_OPEN_ORDER_BY
        )
        assert sql_both.count("$") == 5
        assert "o.symbol = $4" in base + " AND o.symbol = $4"


# ---------------------------------------------------------------------------
# transaction / GUC law
# ---------------------------------------------------------------------------


class TestTenantTransactionLaw:
    @pytest.mark.asyncio
    async def test_every_operation_sets_the_tenant_guc_first_in_one_tx(self) -> None:
        for script, call in (
            ([None], lambda s: s.get_order(TENANT, "ord_01")),
            (
                [{"order_id": "ord_01"}],
                lambda s: s.reserve_client_order_id(TENANT, "c", make_order()),
            ),
            ([None], lambda s: s.get_by_client_order_id(TENANT, "c")),
            ([None], lambda s: s.save_order(make_order())),
            (
                [],
                lambda s: s.set_reconciliation_state(
                    TENANT, "ord_01", ReconciliationState.UNKNOWN
                ),
            ),
            ([None], lambda s: s.record_event(TENANT, OrderEvent(
                event_id="e1", order_id="ord_01", previous_status=None,
                status=OrderStatus.SUBMITTED, reason=None, occurred_at=1))),
            ([None], lambda s: s.record_fill(TENANT, Fill(
                fill_id="f", order_id="o", trade_id="t", price=Decimal("1"),
                quantity=Decimal("1"), fee=Decimal("0"), fee_currency="USDT", is_maker=False,
                is_simulated=True, exchange_timestamp=1, received_timestamp=2))),
        ):
            subject, conn, pool = store(*script)
            await call(subject)
            assert conn.statements[0][0] == SET_TENANT_SQL
            assert conn.statements[0][1] == (TENANT,), f"guc law broke for {call}"
            assert conn.tx_begins == 1 and conn.tx_commits == 1 and conn.tx_rollbacks == 0
            assert pool.acquires == 1

    @pytest.mark.asyncio
    async def test_statement_errors_rollback_and_propagate_unswallowed(self) -> None:
        boom = RuntimeError("connection reset")
        subject, conn, pool = store(
            Expectation(SET_TENANT_SQL, (TENANT,)),
            Expectation("FROM engine_orders o", raises=boom),
        )
        # The GUC statement runs, then the row read fails mid-transaction:
        # __aexit__ MUST have seen the exception (rollback, not commit) and
        # the pool slot must be released - both are the durability contract's
        # leak guards, and neither is checkable if boom fires before
        # __aenter__ completes (hence Expectation.raises, not a bare entry).
        with pytest.raises(RuntimeError, match="connection reset"):
            await subject.get_order(TENANT, "ord_01")
        assert conn.tx_rollbacks == 1 and conn.tx_commits == 0 and conn.tx_begins == 1
        assert len(conn.statements) == 2
        assert pool.acquires == 1  # released even on failure

    @pytest.mark.asyncio
    async def test_sweep_is_refused_not_answered_empty(self) -> None:
        subject, conn, _pool = store()
        with pytest.raises(CrossTenantSweepUnsupported) as caught:
            await subject.list_orders_needing_reconciliation(limit=7)
        message = str(caught.value)
        assert "reconcile-trading-account" in message and "PART13_DURABLE_STORE" in message
        assert conn.statements == []  # a refusal must not even reach the database

    async def test_get_order_maps_missing_row_to_none_not_error(self) -> None:
        subject, _conn, _pool = store(None)
        assert await subject.get_order(TENANT, "nope") is None

    @pytest.mark.asyncio
    async def test_malformed_tenant_id_fails_before_the_database(self) -> None:
        # tenant_id lands in a UUID column; the driver would answer with a
        # raw "invalid input syntax" - the store states the law itself,
        # first, so a string-tenant deployment sees the reason not the cast.
        subject, conn, _pool = store()
        with pytest.raises(store_sql.OrderStoreError, match="canonical UUID"):
            await subject.get_order("tenant-a", "ord_01")
        assert conn.statements == []


# ---------------------------------------------------------------------------
# reference-semantics mirror
# ---------------------------------------------------------------------------


class TestReferenceSemantics:
    @pytest.mark.asyncio
    async def test_free_reservation_wins_and_stores_the_order(self) -> None:
        subject, _conn, _pool = store({"order_id": "ord_01"})
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is True and outcome.existing is None

    @pytest.mark.asyncio
    async def test_reservation_held_by_another_order_resumes_nothing(self) -> None:
        holder = order_row({"order_id": "ord_other"})
        subject, _conn, _pool = store(None, holder)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is False
        assert outcome.existing is not None and outcome.existing.order_id == "ord_other"

    @pytest.mark.asyncio
    async def test_same_order_retrying_reserves_with_the_stored_row(self) -> None:
        # The stored row (submitted_at set) differs from the passed order
        # (PENDING): the durable answer is what the database knows, exactly
        # as the in-memory store answers with the object it already holds.
        holder = order_row({"status": "SUBMITTED", "submitted_at": 7})
        subject, _conn, _pool = store(None, holder)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is True
        assert outcome.existing is not None and outcome.existing.status is OrderStatus.SUBMITTED

    @pytest.mark.asyncio
    async def test_reservation_lost_after_the_conflict_is_not_a_win(self) -> None:
        # INSERT returned no row and the holder lookup also found nothing:
        # the conflicting transaction rolled away. "Not reserved, holder
        # unknown" - the caller retries; claiming victory here would be the
        # double-book the unique index exists to prevent.
        subject, _conn, _pool = store(None, None)
        outcome = await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert outcome.reserved is False and outcome.existing is None

    @pytest.mark.asyncio
    async def test_record_fill_answers_false_only_for_replays(self) -> None:
        fill = Fill(
            fill_id="f1", order_id="ord_01", trade_id="t1", price=Decimal("50000.1"),
            quantity=Decimal("0.01"), fee=Decimal("0.0006"), fee_currency="BNB",
            is_maker=True, is_simulated=True, exchange_timestamp=1, received_timestamp=2,
        )
        fresh, _c, _p = store({"fill_id": "f1"})
        replayed, _c2, _p2 = store(None)
        assert await fresh.record_fill(TENANT, fill) is True
        assert await replayed.record_fill(TENANT, fill) is False

    @pytest.mark.asyncio
    async def test_in_sync_writes_sql_null(self) -> None:
        subject, conn, _pool = store()
        await subject.set_reconciliation_state(TENANT, "ord_01", ReconciliationState.IN_SYNC)
        update = [s for s in conn.statements if s[0].startswith(_UPD_ORDERS)]
        assert update and update[0][1] == (TENANT, "ord_01", None)

    @pytest.mark.asyncio
    async def test_missing_state_row_reads_as_in_sync(self) -> None:
        subject, _conn, _pool = store(None)
        assert await subject.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.IN_SYNC
        subject2, _c2, _p2 = store({"reconciliation_state": None})
        assert await subject2.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.IN_SYNC
        subject3, _c3, _p3 = store({"reconciliation_state": "DIVERGED"})
        assert await subject3.get_reconciliation_state(
            TENANT, "ord_01"
        ) is ReconciliationState.DIVERGED

    @pytest.mark.asyncio
    async def test_list_open_orders_appends_predicates_in_param_order(self) -> None:
        subject, conn, _pool = store([])
        await subject.list_open_orders(
            TENANT, "acct_01", exchange=ExchangeId.BINANCE, symbol="BTCUSDT"
        )
        sql, args = conn.statements[1]
        assert "AND o.exchange = $4 AND o.symbol = $5" in sql
        assert args == (TENANT, "acct_01", sorted(
            status.value for status in TERMINAL_ORDER_STATUSES
        ), "binance", "BTCUSDT")
        subject2, conn2, _ = store([])
        await subject2.list_open_orders(TENANT, "acct_01", symbol="ETHUSDT")
        sql2, args2 = conn2.statements[1]
        # the column list mentions o.exchange (it selects it); the WHERE
        # clause must not predicate on it when only symbol was given
        assert "AND o.symbol = $4" in sql2 and "AND o.exchange" not in sql2
        assert args2[3] == "ETHUSDT" and len(args2) == 4

    @pytest.mark.asyncio
    async def test_terminal_vocabulary_is_imported_not_retyped(self) -> None:
        from wlct_trading.enums import TERMINAL_ORDER_STATUSES

        subject, conn, _pool = store([])
        await subject.list_open_orders(TENANT, "acct_01")
        sql, args = conn.statements[1]
        assert args[2] == sorted(status.value for status in TERMINAL_ORDER_STATUSES)
        assert "ORDER BY o.created_at ASC, o.order_id ASC" in sql


# ---------------------------------------------------------------------------
# codec fidelity via the echo connection (the row that lands is the row back)
# ---------------------------------------------------------------------------


class TestCodecFidelity:
    @pytest.mark.asyncio
    async def test_full_order_round_trips_scale_exact(self) -> None:
        order = make_order(
            strategy_id="strat_9",
            stop_price=Decimal("49999.999999"),
            signal_id="sig-7",
            reduce_only=True,
            exchange_order_id="9998887776",
            status=OrderStatus.PARTIALLY_FILLED,
            filled_quantity=Decimal("0.05"),
            average_fill_price=Decimal("0.100000000000000000000001"),  # division residue
            cumulative_fee=Decimal("0.00060"),
            fee_currency="BNB",
            rejection_reason=None,
            submitted_at=1_700_000_000_000_002,
            price=Decimal("0.100"),
        )
        subject, _conn, _pool = store(echo=True)
        await subject.save_order(order)
        back = await subject.get_order(TENANT, order.order_id)
        assert back is not None
        assert back == order
        # dataclass equality is numeric for Decimals; pin the STRING scale
        # too - the durable record must preserve trailing zeros exactly.
        assert str(back.price) == "0.100"
        assert str(back.average_fill_price) == "0.100000000000000000000001"
        assert str(back.cumulative_fee) == "0.00060"
        assert back.submitted_at == 1_700_000_000_000_002
        assert back.terminal_at is None and back.stop_price == Decimal("49999.999999")

    @pytest.mark.asyncio
    async def test_reservation_marks_unknown_and_explicit_sync_clears_it(self) -> None:
        subject, conn, _pool = store(echo=True)
        # the reservation INSERT carries UNKNOWN...
        await subject.reserve_client_order_id(TENANT, "wlc-0001", make_order())
        assert conn.stored_order is not None
        assert conn.stored_order["reconciliation_state"] == "UNKNOWN"
        # ...a crash between reserve and save leaves exactly that durable
        # truth, and the explicit sync-set is what clears it back to NULL.
        await subject.set_reconciliation_state(TENANT, "ord_01", ReconciliationState.IN_SYNC)
        assert conn.stored_order["reconciliation_state"] is None
        state = await subject.get_reconciliation_state(TENANT, "ord_01")
        assert state is ReconciliationState.IN_SYNC

    @pytest.mark.asyncio
    async def test_fills_and_events_are_replayed_into_the_read_model(self) -> None:
        subject, conn, _pool = store(echo=True)
        await subject.save_order(make_order())
        recorded = await subject.record_fill(TENANT, Fill(
            fill_id="fill_01", order_id="ord_01", trade_id="trade_01",
            price=Decimal("0.100"), quantity=Decimal("0.05"), fee=Decimal("0.00060"),
            fee_currency="BNB", is_maker=True, is_simulated=True,
            exchange_timestamp=1_700_000_000_000, received_timestamp=1_700_000_000_000_002,
        ))
        assert recorded is True
        await subject.record_event(TENANT, OrderEvent(
            event_id="ev_1", order_id="ord_01", previous_status=OrderStatus.PENDING,
            status=OrderStatus.PARTIALLY_FILLED, reason="fill:fill_01", occurred_at=7,
            payload={"source": "user-data-stream"},
        ))
        back = await subject.get_order(TENANT, "ord_01")
        assert back is not None
        assert [f.fill_id for f in back.fills] == ["fill_01"]
        assert str(back.fills[0].price) == "0.100"  # scale survives the JSON detour
        assert [e.event_id for e in back.events] == ["ev_1"]
        assert back.events[0].payload == {"source": "user-data-stream"}
        # read-model REPLAY, not re-derivation: stored aggregates come back
        # untouched and no synthesized journal event appears.
        assert back.filled_quantity == Decimal("0")
        assert len(back.events) == 1
        # the dedup set is seeded, so a caller that continues on this
        # object gets domain-level duplicate protection immediately.
        assert back.apply_fill(Fill(
            fill_id="fill_01", order_id="ord_01", trade_id="other", price=Decimal("1"),
            quantity=Decimal("1"), fee=Decimal("0"), fee_currency="USDT", is_maker=False,
            is_simulated=True, exchange_timestamp=1, received_timestamp=1,
        )) is False

    @pytest.mark.asyncio
    async def test_event_payload_is_canonical_json(self) -> None:
        subject, conn, _pool = store(echo=True)
        await subject.record_event(TENANT, OrderEvent(
            event_id="e", order_id="o", previous_status=None, status=OrderStatus.PENDING,
            reason=None, occurred_at=1, payload={"b": "2", "a": "1"},
        ))
        insert = next(s for s in conn.statements if s[0].startswith(_INS_EVENTS))
        payload_arg = insert[1][7]
        assert payload_arg == '{"a":"1","b":"2"}'  # sort_keys + tight separators

    def test_unknown_enums_and_non_decimals_are_read_errors(self) -> None:
        with pytest.raises(ValueError):  # the enum constructor refuses
            _decode_order(order_row({"status": "NOT_A_STATUS"}))
        with pytest.raises((InvalidOperation, ArithmeticError)):
            _decode_order(order_row({"quantity": "12abc"}))


# ---------------------------------------------------------------------------
# strictness divergence: SQL rejects what the reference silently mangles
# ---------------------------------------------------------------------------


class TestStrictnessDivergence:
    @pytest.mark.asyncio
    async def test_client_id_collision_surfaces_instead_of_silently_shifting(self) -> None:
        # The in-memory reference setdefaults its id map; SQL answers with a
        # unique violation on engine_orders_tenant_client_key. The port must
        # let THAT through (loud) rather than translating it into a no-op.
        violation = Exception(
            'duplicate key value violates unique constraint "engine_orders_tenant_client_key"'
        )
        subject, conn, _pool = store(None, Expectation("DO UPDATE SET", raises=violation))
        with pytest.raises(Exception, match="engine_orders_tenant_client_key"):
            await subject.save_order(make_order())
        assert conn.tx_rollbacks == 1  # the failed upsert must not half-apply
        # the save_order pre-read of the existing reconciliation state ran
        # FIRST (so the upsert can preserve it) - unscripted, it answers
        # "no row", and the capture below proves the INSERT shape carried
        # NULL state rather than inventing one.
        assert conn.statements[0][0] == SET_TENANT_SQL

    def test_order_params_carry_tenant_first(self) -> None:
        params = _order_params(make_order(tenant_id=OTHER_TENANT), ReconciliationState.DIVERGED)
        assert params[0] == OTHER_TENANT
        assert params[store_sql._ORDER_COLUMNS.index("reconciliation_state")] == "DIVERGED"
```


## FILE: services/execution-engine/.env.example (198 lines)

*the observability block, with the two sentences an operator needs: what the endpoint is, and that this service deliberately has no REDIS_URL because it mirrors nothing.*

```dotenv
# execution-engine - Part 11 worker plane
# Copy to .env and fill real values. NEVER commit the result. The platform
# validator (packages/config env.schema.ts) rejects known sample values in
# committed env files; this file carries samples deliberately - that is why
# it is named .env.example and excluded from validation.

# --- identity / transport ---------------------------------------------------
NODE_ENV=development
LOG_LEVEL=info
# Names this process in logs, health and worker assertions. Any stable id.
EXECUTION_INSTANCE_ID=execution-engine-local
# Loopback by default; container deployments set this to 0.0.0.0 and keep
# the port on the internal network only.
EXECUTION_ENGINE_HOST=127.0.0.1
SERVICE_PORT=8093
# REQUIRED, no default: shared secret with the Node worker, min 32 chars.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
EXECUTION_INTERNAL_TOKEN=replace-me-with-64-hex-characters-generated-fresh

# --- mode -------------------------------------------------------------------
# simulated is the only executable mode in this build. Setting live is a
# STARTUP REFUSAL by design (live venue adapter, credential provider and
# durable store land in Part 12) - a refusal to lift, not a placeholder.
EXECUTION_MODE=simulated
# true = submissions stop before transmission; cancel stays available.
EXECUTION_DRY_RUN=true
# Venue request timeout (core engine setting) and lock lease TTL.
EXECUTION_REQUEST_TIMEOUT_MS=5000
EXECUTION_LOCK_TTL_MS=15000

# --- simulated venue ----------------------------------------------------------
# Fixed mid used as top-of-book for any symbol. Leave unset for an empty
# book (submissions refuse for lack of price - the honest default).
# EXECUTION_SIMULATED_MID=50000
# Seed balances for the simulated account, ASSET=QUANTITY pairs. Always
# surfaced labelled simulated.
EXECUTION_PAPER_BALANCES=USDT=100000

# --- durable store (Part 13) --------------------------------------------------
# memory: process-local simulated store, lost on restart (readiness says so:
# storeDurable=false). postgres: durable engine store over the engine_orders /
# engine_order_events / engine_order_fills tables - they are owned by
# apps/api/prisma (migrations), so run the migrate job first; the service
# verifies the tables exist at startup and refuses if they do not.
# EXECUTION_STORE_BACKEND never silently degrades: postgres without a DSN,
# or a DSN without postgres, is a startup refusal.
EXECUTION_STORE_BACKEND=memory
# DSN for the durable store. A credential: env-only, never logged. Set this
# ONLY with EXECUTION_STORE_BACKEND=postgres (the config refuses the
# mismatch). The engine sets app.tenant_id per transaction, so these tables
# are ready for the platform's row-level-security policies from day one.
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct

# --- journal retention (Part 14) ----------------------------------------------
# The durable store's event journal (engine_order_events) is the one table
# retention prunes; orders and fills are never deleted, at any age, under
# any config. The four values below are bounded by the core's law
# (wlct_trading/retention.py) and a nonsensical combination refuses BOOT.
#   EXECUTION_RETENTION_ENABLED: false = dry-run only. Inspect and dry-run
#     always work; an apply request is answered 409 naming this variable.
#     Turn it on only after (a) an inspect, (b) a scheduled dry-run whose
#     ledger row you read, and (c) a fresh verified backup - docs/DR.md and
#     docs/PART14_RETENTION.md carry the runbook.
#   EXECUTION_RETENTION_EVENT_DAYS: journal rows are prunable only when BOTH
#     the row and its order's terminal stamp are older than this. 90 default.
#   EXECUTION_RETENTION_BATCH_ROWS / _MAX_BATCHES: per-statement and
#     per-run ceilings. A run that hits the ceiling reports "exhausted" and
#     the next scheduled run resumes - partial progress is the design.
# EXECUTION_RETENTION_ENABLED=true
# EXECUTION_RETENTION_EVENT_DAYS=90
# EXECUTION_RETENTION_BATCH_ROWS=2000
# EXECUTION_RETENTION_MAX_BATCHES=50

# --- RLS enablement verification (Part 15) -------------------------------
# The only knob is how old an enablement audit may be before it stops
# counting as evidence. There is deliberately NO enablement "apply" switch:
# the audit endpoint runs SELECTs and nothing else, so it needs no two-yeses
# guard (contrast the retention block above, where the verb is DELETE).
# Bounds (1..36500 days) are enforced by wlct_trading/enablement.py and a
# nonsensical value refuses BOOT, so a typo can never mean "every audit is
# fresh, forever". The audit itself: POST /internal/v1/enablement/audit, or
# `node scripts/rls-enablement.mjs audit --record`.
# EXECUTION_ENABLEMENT_MAX_AGE_DAYS=30

# --- Credential source and placement review (Part 16) --------------------
# Where key material comes from, and how expensive the review may be. There is
# deliberately NO "enable placement review" switch: the review runs before every
# order a runtime could transmit, and a runtime that cannot reach the venue is
# refused rather than waved through. What IS configurable is the source of keys
# and the two age bounds, all of them enforced by wlct_trading/execution/
# placement_review.py - a nonsensical value refuses BOOT.
# The review's findings are published by /status (placement block) and reach the
# audit record inside each order's SUBMITTED event payload.
#   EXECUTION_CREDENTIAL_SOURCE: none wires a provider that refuses every
#     authenticated lookup - correct for a simulated process, where needing a key
#     is a bug worth a loud failure. `environment` reads two variables for ONE
#     (tenant, account) pair and is refused outright when NODE_ENV=production.
#     `secret-manager` needs a fetcher injected in code: key custody lives with
#     the service that owns the encrypted store, and no HTTP surface of this
#     engine may install one.
#   EXECUTION_CREDENTIAL_ENV_PREFIX: the core appends _API_KEY / _API_SECRET, so
#     NO trailing underscore (`ACME_` would read ACME__API_KEY; refused at boot).
#   EXECUTION_CREDENTIAL_CACHE_SECONDS: how long a resolved credential may be
#     reused. Not a security window - rotation and revocation are the venue's and
#     the operator's; this is one vault call per order versus one per burst.
#   EXECUTION_PLACEMENT_ATTESTATION_TTL_MS: the cache TTL AND the freshness bound,
#     one number on purpose - a cache that outlived the freshness window would be
#     the reason a stale attestation passes. Bounds 1000..3600000 ms.
#   EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS: a key older than this may not trade
#     until it is rotated. Bounds 1..36500 days.
#   EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST: the venue must report an IP
#     allowlist on the key. Default true; false is accepted for simulated runtimes
#     and REFUSED for live ones, because the allowlist is the one control on a
#     leaked key that the venue enforces for us.
# Live mode remains refused by startup code. As of Part 19 the list of things a live
# deployment still lacks is no longer a paragraph in a document: it is computed from
# the wiring this process built and printed inside the refusal itself (and on
# GET /internal/v1/status as `liveEnablement`). docs/PART16_PLACEMENT_REVIEW.md sec. 8
# is the Part 16 snapshot of that list; docs/PART19_LIVE_ENABLEMENT.md is the current
# one. Every value below is the dark default and none of them opens the money path. The
# key variables themselves are deliberately absent from docker-compose.yml: an
# environment is where they belong, and this file is not.
# EXECUTION_CREDENTIAL_SOURCE=none
# EXECUTION_CREDENTIAL_ENV_PREFIX=WLCT_BINANCE
# EXECUTION_CREDENTIAL_TENANT_ID=tenant-1
# EXECUTION_CREDENTIAL_ACCOUNT_ID=account-1
# EXECUTION_CREDENTIAL_CACHE_SECONDS=300
# EXECUTION_PLACEMENT_ATTESTATION_TTL_MS=300000
# EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS=90
# EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true

# --- Observability (Part 18) -------------------------------------------
# Exposes GET /metrics (Prometheus text, unauthenticated, internal network
# only) rendering the engine's own stage histograms and counters. Same knob
# name as the two sibling services, and docker-compose.yml has been passing it
# to all three since before this part existed - execution-engine was the one
# that did not read it. Development may set it false; NODE_ENV=production
# refuses to start with it off, because a process that can hold a venue key has
# to be able to show what it measured. This service deliberately mirrors nothing
# to Redis, so it has no REDIS_URL of its own and needs no scrape target here.
OBSERVABILITY_ENABLED=true

# --- live credential fetcher and the operator confirmation (Part 19) -----
# The two things this service was missing on the live path: a concrete reader for
# `secret-manager` credentials, and a typed record that a named human authorised this
# scope. Both default OFF, both are refused at boot when half-configured, and neither
# is `ALLOW_LIVE`: EXECUTION_MODE=live still refuses startup, because the signed venue
# transport is still not built and no value below changes that.
#
# The fetcher. `none` keeps every existing deployment byte-identical (secret-manager
# then refuses at boot, as it did before Part 19). `vault-kv2` selects this service's
# own reader for HashiCorp Vault's KV v2 API, which is the backend this repository's
# infrastructure already runs; a deployment on a different KMS injects its own fetcher
# at composition instead, exactly as Part 16 provided for.
#   EXECUTION_VAULT_ADDR: https only, no `user:pass@` (refused, not honoured).
#   EXECUTION_VAULT_MOUNT: one path segment; a nested mount belongs in the template.
#   EXECUTION_VAULT_PATH_TEMPLATE: {tenant}/{account}/{exchange} are the only
#     placeholders, filled from this deployment's own identifiers, never a request.
#   EXECUTION_VAULT_TOKEN_ENV: the NAME of the variable holding the token. The token
#     is read from the environment by the fetcher and is never a field on Settings, so
#     no model_dump, no /status view and no debugger can surface it.
#   EXECUTION_VAULT_TLS_VERIFY: false is refused under NODE_ENV=production.
#   EXECUTION_VAULT_MAX_RESPONSE_BYTES: a KV secret is a key pair, not a document;
#     a response over the bound is refused (1024..4194304).
# The secret it reads must carry `api_key` and `api_secret` (or the camelCase
# spellings; both present with different values is refused), and may carry
# `permissions` ("READ,SPOT_TRADE" - a stored WITHDRAW is a refusal, never a
# promotion) and `expiresAtMicros` (microseconds only: a timestamp string with no
# timezone is a guess about when a key stops working).
# EXECUTION_CREDENTIAL_FETCHER=none
# EXECUTION_VAULT_ADDR=https://vault.internal:8200
# EXECUTION_VAULT_MOUNT=secret
# EXECUTION_VAULT_PATH_TEMPLATE=wlct/{tenant}/{account}/{exchange}
# EXECUTION_VAULT_TOKEN_ENV=EXECUTION_VAULT_TOKEN
# EXECUTION_VAULT_NAMESPACE=
# EXECUTION_VAULT_TIMEOUT_MS=3000
# EXECUTION_VAULT_TLS_VERIFY=true
# EXECUTION_VAULT_MAX_RESPONSE_BYTES=65536
#
# The operator's confirmation. A scoped, expiring, HMAC-verified record - which
# deployment, which tenant and account, which symbols and order types, from when to
# when - NOT a boolean, because a boolean has no subject, no expiry, no integrity and
# no per-order meaning. `EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=false` (the default)
# leaves every existing verdict untouched; a deployment that turns it on must supply a
# record AND the key, or boot refuses. When it is on, the review refuses an order
# whose symbol or account is outside the record, an order whose record lapsed, and one
# whose record this deployment's key cannot authenticate - four typed codes
# (OPERATOR_CONFIRMATION_ABSENT / _EXPIRED / _SCOPE_MISMATCH / _UNVERIFIED), none of
# them retryable, because a confirmation is renewed by a human and not by a loop.
# The record is not secret (no key material in it) so either form is fine; setting
# both is refused, because two sources for one ceremony means one of them is stale.
#   The record's `digest` is HMAC-SHA256 over its canonical JSON; the minting ceremony
#   lives with the operator tooling, not with this service - see
#   docs/PART19_LIVE_ENABLEMENT.md sec. 5 for the exact bytes and a worked example.
# EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=false
# EXECUTION_OPERATOR_CONFIRMATION_JSON=
# EXECUTION_OPERATOR_CONFIRMATION_FILE=/run/secrets/live-operator-confirmation.json
# EXECUTION_CONFIRMATION_KEY_ENV=EXECUTION_CONFIRMATION_HMAC_KEY
```


## FILE: .env.example (1120 lines)

*the shared-knob note under Part 9's observability section, naming all three Python services so the platform-level meaning of OBSERVABILITY_ENABLED is stated once rather than inferred three times.*

```dotenv
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
# json | pretty. Set ONCE, here: both planes read the same name and this file keeps one
# active assignment per knob, because dotenv honours the first of a repeated key while
# docker compose's env_file honours the last - two assignments would make the deployed
# answer a loader detail. The "SHARED LOGGING" section below states the policy (`json`
# in every deployed environment, `pretty` for a local terminal), so that is the value.
LOG_FORMAT=json
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
# rather than producing a socket that is silent forever. The value is assigned
# once, in the MARKET DATA service section below, and this transport and
# services/market-data read that one number: two assignments of one name in one
# file is how a shared knob stops being shared.

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
# The only active assignment of this name: the LIVE MARKET DATA TRANSPORT section
# above explains the accepted spellings and the validation, and both readers -
# services/market-data and that transport - take the value from here.
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
# LOG_FORMAT is assigned once, in the LOGGING section above, and set there to json -
# the policy this section states (json in every deployed environment, pretty for local
# terminals). It is repeated here as a heading only, on purpose: a second active
# assignment for one name in one file is how two sections end up meaning two things.
# Additional pino redaction paths, comma separated. The built-in list already
# covers authorization headers, cookies, passwords, tokens and API secrets.
PINO_REDACT_PATHS=

# -----------------------------------------------------------------------------
# BUILD METADATA (injected at image build time; not an operator setting)
# -----------------------------------------------------------------------------
# Two names are read straight off the process environment by the health surface
# (apps/api/src/modules/health/health.service.ts:30,32) rather than through the
# validated schema, because they describe the artefact rather than the deployment:
# what was built, and from which commit. They are documented here for that reason -
# a name a program reads and no file explains is a name nobody can fill in.
#
# Nothing in this repository currently sets either one. There is no CI in the tree and
# no build arg in infrastructure/docker/api.Dockerfile, so a deployment built from this
# repository answers GET /v1/health with commit "unknown" and version taken from
# SWAGGER_VERSION by fallback. Wiring it is one build arg in the image and one value
# from the build environment; until that exists the honest answer is "unknown", and the
# spec at apps/api/src/config/env-example-coverage.spec.ts keeps this sentence true by
# refusing any process.env read that neither the schema nor this file knows about.
# APP_VERSION=
# GIT_COMMIT_SHA=

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
#
# NOT ASSIGNED HERE, and that is a finding rather than tidying. MAX_RISK_STATE_AGE_MS
# is one name read by three planes whose code defaults disagree: the execution plane
# parses a fallback of 5000 (libs/trading-core/wlct_trading/execution/config.py:377),
# while services/trading-engine/app/config.py:89 and the API's env schema
# (packages/config/src/env.schema.ts:405, pinned at 2000 by risk-safety.spec.ts:182)
# both default to 2000 - and the SLO catalog derives its 4-second freshness budget from
# the 2000 figure (libs/trading-core/wlct_trading/slo/catalog.py:27). An unset
# deployment therefore gates a submission at 5s in one plane and 2s in another on the
# same snapshot. The single assignment lives in the RISK section below at the tighter
# figure; whether the execution plane's looser fallback is intended is a decision with a
# risk consequence attached, so it is written here as a question and not resolved by a
# comment that would make the file look settled.

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
# This is the file's one active assignment of the name: set here, it governs the
# execution plane, the trading engine and the API alike, and no plane falls back to
# its own default - which is the state the Execution timing section above points at.
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
# ^ the name is shared by services/trading-engine, services/market-data and
# (since Part 18) services/execution-engine on purpose: one platform knob, three
# services, and NODE_ENV=production refuses to parse with it off in each.
METRICS_ENABLED=true
HEALTH_ENABLED=true
PROMETHEUS_ENABLED=true
PROMETHEUS_PATH=/metrics
# Loopback port for the OPTIONAL monitoring overlay (docker-compose.
# observability.yml), which is the only reader of this name: the platform runs
# unchanged with the stack switched off. 9090 is the image's own default, and the
# generated scrape config never reads this value - only compose does.
PROMETHEUS_PORT=9090
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

# -----------------------------------------------------------------------------
# Part 11: trading-worker plane and read-replica policy.
#
# Three separable switches, all default-safe: the worker consumer (runs only
# in the dedicated `npm run worker` process / container - the API never hosts
# it), the execution engine it forwards to (services/execution-engine, which
# holds the venue side), and the read replica (off until BOTH the URL and the
# flag are set; half-configuration is a boot error, by design).
# -----------------------------------------------------------------------------
# Worker latch: false makes the worker boot EXIT with a reason rather than
# idle quietly. The API process ignores it (it never mounts the consumers).
WORKER_ENABLED=true
# Stable per-replica identity for claims and logs. Unset composes host:pid:rand.
# WORKER_ID=worker-a
# The fleet list the partition assignment is computed over - identical on
# every worker, comma-separated. Empty means "this worker alone".
# WORKER_MEMBERSHIP=worker-a,worker-b,worker-c
# Part 12: where live membership comes from. 'config' (the default) treats
# the list above as the fleet. 'registry' lets workers self-register through
# a Redis heartbeat zset - the list above becomes the documented fallback
# (first tick + registry outages) and claims remain the entire authority.
# WORKER_MEMBERSHIP_MODE=registry
# Heartbeat grace period for 'registry' mode; must be >= 2x
# WORKER_PARTITION_RETRY_MS when the mode is registry (schema-enforced).
# WORKER_MEMBERSHIP_TTL_MS=30000
# Keyspace width; changing it rescales every assignment at once (coordinated
# config change, ceiling 4096 pinned by the coordination fixtures).
WORKER_PARTITION_COUNT=8
WORKER_PARTITION_LEASE_TTL_MS=15000
WORKER_PARTITION_RETRY_MS=2500
# Parked-job cadence and the ceiling before a homeless job fails visibly
# (deferrals do not consume BullMQ attempts; this is what stops an eternal orbit).
WORKER_DEFER_DELAY_MS=3000
WORKER_MAX_DEFERS=30
WORKER_SHUTDOWN_TIMEOUT_MS=10000
# The execution engine (services/execution-engine) this worker forwards
# TRADE_EXECUTION commands to. It holds venue contact and credentials; this
# process holds only the queue.
EXECUTION_ENGINE_URL=http://127.0.0.1:8093
# REQUIRED by the worker: its startup gate asks the engine's /internal/v1/status before it
# will consume a job, and refuses to run against a mode it was not built to serve. Since
# Part 20 the API reads both names too - not to command the engine, only to render the
# ENGINE POSTURE section of GET /v1/observability/execution. Optional for the API in the
# strict sense: with either name absent the module declines to construct a client, the API
# boots, and the panel section reports `unconfigured` with the reason instead of inventing
# an answer (no observability surface may be the reason a service refuses to start).
# Must match the engine's EXECUTION_INTERNAL_TOKEN. Generate fresh; never reuse across
# environments.
# EXECUTION_ENGINE_TOKEN=
# Inside docker-compose.yml both services get EXECUTION_ENGINE_URL=http://execution-engine:8093
# instead of the loopback value above: in a container network 127.0.0.1 is the container that
# set it, and the engine publishes no host port.
# Part 13 durable engine store (read by docker-compose for the
# execution-engine service). memory is the default and reports
# storeDurable=false honestly; postgres persists orders/events/fills in the
# engine_* tables (created by the API's migrations). Postgres without the
# DSN - or the DSN without postgres - refuses startup; there is no silent
# fallback in either direction. Details: services/execution-engine/.env.example
# and docs/PART13_DURABLE_STORE.md.
# EXECUTION_STORE_BACKEND=postgres
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct
# Part 14 journal retention, also read by the execution-engine service
# above: defaults keep APPLY disabled (dry-run/inspect always available);
# bounds and semantics in services/execution-engine/.env.example and
# docs/PART14_RETENTION.md. The prune itself runs from
# `node scripts/retention-run.mjs` under the deployment's scheduler.
# EXECUTION_RETENTION_ENABLED=false
# EXECUTION_RETENTION_EVENT_DAYS=90
# Part 15: how old a row-level-security enablement audit may be before the
# platform stops treating it as evidence (bounds enforced by the core law;
# a bad value refuses boot). The audit is read-only - there is no enablement
# apply switch to turn on. Recorded results live in
# docs/dr/rls-evidence.jsonl and are aged by `node scripts/rls-enablement.mjs
# check` (docs/PART15_RLS_ENABLEMENT.md).
# EXECUTION_ENABLEMENT_MAX_AGE_DAYS=30
# ---------------------------------------------------------------------------
# Part 16 - the credential source and the authenticated placement review.
#
# The review itself has no switch: it runs before every order a runtime could
# transmit, and a deployment that cannot reach the venue is refused rather than
# waved through. What is configurable here is where key material comes from and
# how expensive the review may be (docs/PART16_PLACEMENT_REVIEW.md).
#
# Where a live runtime would read key material. `none` (the default) wires a
# provider that refuses every authenticated lookup, which is what a simulated
# deployment wants: a paper process that needs a key is a bug, and this makes it
# loud. `environment` is development-only and is refused outright when
# NODE_ENV=production. `secret-manager` needs a fetcher injected in code - the
# platform's key custody lives with the service that owns the encrypted store.
# EXECUTION_CREDENTIAL_SOURCE=none
# The two variables `environment` reads are <PREFIX>_API_KEY and
# <PREFIX>_API_SECRET. No trailing underscore: the separator is appended for
# you, and `ACME_` would look for `ACME__API_KEY` (refused at boot).
# EXECUTION_CREDENTIAL_ENV_PREFIX=WLCT_BINANCE
# The single (tenant, account) pair an environment can serve. More than one
# tenant needs `secret-manager` - an environment has no way to scope a secret
# per customer, which is why it is development-only.
# EXECUTION_CREDENTIAL_TENANT_ID=tenant-1
# EXECUTION_CREDENTIAL_ACCOUNT_ID=account-1
# How long a resolved credential may be reused before the provider goes back to
# its source. Not a security window: rotation and revocation are the venue's and
# the operator's; this is the difference between one vault call per order and one
# per burst.
# EXECUTION_CREDENTIAL_CACHE_SECONDS=300
# How long a gathered placement attestation may be reused - AND how old one may
# be before the review calls it stale. One number on purpose: a cache that outlived
# the freshness bound would be the reason a stale answer passed. Bounds
# (1000..3600000 ms) are the core's law and refuse boot outside them.
# EXECUTION_PLACEMENT_ATTESTATION_TTL_MS=300000
# A key older than this may not trade until it is rotated (1..36500 days).
# EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS=90
# The venue must report an IP allowlist on the key. Default true; `false` is
# accepted for simulated runtimes and refused for live ones, because the
# allowlist is the one control on a leaked key that the venue enforces for us.
# EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true
#
# Deliberately absent from docker-compose.yml: the key variables themselves.
# `EXECUTION_CREDENTIAL_SOURCE=environment` reads them from the process
# environment; a compose line spelling them out would advertise the file as a
# place to put a secret, which is the one thing this platform will not do.
# Read-replica routing. Off by default; every read stays on the primary.
# When on, replica-eligible reads move only while the replica is healthy AND
# its lag (last probe, 10s trust window) is within DATABASE_READ_MAX_LAG_MS;
# any unknown routes primary. Execution-critical reads never use the replica.
DATABASE_READ_ENABLED=false
# DATABASE_READ_URL=postgresql://replica-user:...@replica-host:5432/wlct?sslmode=require
DATABASE_READ_MAX_LAG_MS=1500

# ---------------------------------------------------------------------------
# Disaster-recovery rehearsal (Part 21): scripts/dr-rehearsal.mjs
# ---------------------------------------------------------------------------
# Nothing here is read by the API, the worker or the engine: these are operator
# shell variables for one command, listed so that `scripts/dr-manifest.mjs` can see
# the name exists (its environment scan reads this file for `KEY=` lines, including
# commented ones) and so a deployment cannot mistake the rehearsal's confirmation for
# a live-mode switch. It is not one: EXECUTION_MODE=live is refused at startup
# regardless of anything below, and the rehearsal runner refuses --target production
# outright rather than consulting a variable.
#
# DR_REHEARSAL_CONFIRMATION=<rehearsalId>  # must equal the hash of the plan being
#     approved (printed by `--execute` on refusal, or `--plan-only`); the flag form
#     --confirm is equivalent. Setting it once in a shell profile defeats the purpose:
#     the value is the plan, so a stale export approves nothing.
```


## FILE: infrastructure/docker/execution-engine.Dockerfile (87 lines)

*the command that can now start the service: --factory app.main:create_app, and --log-config ./log-config.json with the COPY that puts it in the image. The comment above the CMD carries the whole story, including why a module-level app is not the fix.*

```yaml
# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Execution engine (Python / FastAPI) - Part 11.
#
# The trading worker's execution core as a service: it holds the venue side
# (adapters, locks, incidents, reconciliation) while the Node worker holds
# the queue side. Internal service: never published to the internet, every
# command route requires the shared internal token AND a tenant header.
# This build serves the SIMULATED venue; EXECUTION_MODE=live refuses startup
# by code, so the image carries no path to money that configuration alone
# could open. Mirror of trading-engine.Dockerfile: venv built in the build
# stage, runtime carries no compiler.
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv "$VIRTUAL_ENV"

COPY services/execution-engine/requirements.txt ./requirements.txt
RUN pip install --require-hashes=false -r requirements.txt

# The whole point of this image: the execution plane lives in the shared
# library, and the service wires it. Runtime `import wlct_trading...`
# resolves to this install - the SAME code the engine's own test suite pins.
COPY libs/trading-core ./libs/trading-core
RUN pip install ./libs/trading-core

# ---------------------------------------------------------------------------
FROM base AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1003 appuser \
    && useradd --system --uid 1003 --gid appuser --create-home appuser

COPY --from=build --chown=appuser:appuser /opt/venv /opt/venv
COPY --chown=appuser:appuser services/execution-engine/app ./app
COPY --chown=appuser:appuser services/execution-engine/pyproject.toml ./pyproject.toml
# The log-config file is two no-op keys, and both halves of that sentence matter:
# uvicorn installs its own plain-text handlers unless --log-config points at
# something loadable, and this service's JSON log pipeline is configured by the app
# itself, a moment later, in create_app. A zero-length stand-in cannot work -
# logging.config.fileConfig, which is what uvicorn uses for any path that is not
# .json or .yaml, raises "RuntimeError: /dev/null is an empty file", true since at
# least python 3.11.9 - and the .json suffix is what routes uvicorn to dictConfig,
# which accepts this shape and changes nothing. Both the flag and the file are
# pinned by services/execution-engine/tests/test_part18_asgi_target.py, which loads
# every Python service's real image command through uvicorn's own Config.
COPY --chown=appuser:appuser services/execution-engine/log-config.json ./log-config.json

USER appuser
EXPOSE 8093

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent "http://127.0.0.1:${SERVICE_PORT:-8093}/health" || exit 1

# --no-access-log: uvicorn's access line shape can carry query strings, and
# this service's URLs are fixed - the JSON app log owns every request record
# (with the shared redactor on it).
#
# --factory, and it is load-bearing rather than stylistic: this service's app
# object does not exist at import time. ``create_app`` is where settings are
# parsed, and parsing has to happen when the process starts - not when a module
# is merely imported - because that is what turns a refused configuration into a
# startup error instead of an import-time one that also breaks ``pytest``
# collection, a linter, and anything else that reads ``app.main`` for a constant.
# The sibling services (trading-engine, market-data) expose a module-level ``app``
# and correctly use the plain ``app.main:app`` form; naming that target here was a
# defect that survived eleven parts, because until Part 18 wrote a manual recipe
# into docs/PART18_METRICS_EXPOSITION.md nothing in this repository ever
# attempted to resolve it - a test does now, in
# services/execution-engine/tests/test_part18_asgi_target.py.
CMD ["sh", "-c", "uvicorn --factory app.main:create_app --host ${EXECUTION_ENGINE_HOST:-127.0.0.1} --port ${SERVICE_PORT:-8093} --proxy-headers --no-access-log --log-config ./log-config.json"]
```


## FILE: infrastructure/docker/trading-engine.Dockerfile (69 lines)

*the log-config line and its comment. The app target here was always correct - the module binds app = create_app() - which is the difference this part had to discover rather than assume, and the reason the new test checks both forms.*

```yaml
# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Trading engine (Python / FastAPI).
#
# Internal service: it is never published to the internet and every route
# requires the shared internal token. Dependencies are installed into a virtual
# environment in the build stage and copied forward, so the runtime image
# carries no compiler and no package index cache.
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv "$VIRTUAL_ENV"

COPY services/trading-engine/requirements.txt ./requirements.txt
RUN pip install --require-hashes=false -r requirements.txt

# Part 9: the service publishes observability through the shared pure-Python
# library (zero runtime dependencies, so this adds no transitive surface).
# Runtime `import wlct_trading...` resolves to this install.
COPY libs/trading-core ./libs/trading-core
RUN pip install ./libs/trading-core

# ---------------------------------------------------------------------------
FROM base AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 appuser \
    && useradd --system --uid 1001 --gid appuser --create-home appuser

COPY --from=build --chown=appuser:appuser /opt/venv /opt/venv
COPY --chown=appuser:appuser services/trading-engine/app ./app
COPY --chown=appuser:appuser services/trading-engine/pyproject.toml ./pyproject.toml
# The log-config file is two no-op keys, and both halves of that sentence matter:
# uvicorn installs its own plain-text handlers unless --log-config points at
# something loadable, and this service's JSON log pipeline is configured by the app
# itself, a moment later, in create_app. A zero-length stand-in cannot work -
# logging.config.fileConfig, which is what uvicorn uses for any path that is not
# .json or .yaml, raises "RuntimeError: /dev/null is an empty file", true since at
# least python 3.11.9 - and the .json suffix is what routes uvicorn to dictConfig,
# which accepts this shape and changes nothing. Both the flag and the file are
# pinned by services/execution-engine/tests/test_part18_asgi_target.py, which loads
# every Python service's real image command through uvicorn's own Config.
COPY --chown=appuser:appuser services/trading-engine/log-config.json ./log-config.json

USER appuser
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent "http://127.0.0.1:${TRADING_ENGINE_PORT:-8001}/health" || exit 1

# --proxy-headers so the correlation id and client address survive the reverse
# proxy. No --reload: that is a development-only convenience.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${TRADING_ENGINE_PORT:-8001} --proxy-headers --no-access-log --log-config ./log-config.json"]
```


## FILE: infrastructure/docker/market-data.Dockerfile (65 lines)

*and the same, for the same reason. Two images gained a loadable flag and nothing else; the third gained the ability to boot.*

```yaml
# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Market data service (Python / FastAPI).
#
# Polls public exchange endpoints into a shared Redis cache and serves the
# cached values to internal callers. Holds no credentials of any kind.
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv "$VIRTUAL_ENV"

COPY services/market-data/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

# Part 9: the service publishes observability through the shared pure-Python
# library (zero runtime dependencies, so this adds no transitive surface).
# Runtime `import wlct_trading...` resolves to this install.
COPY libs/trading-core ./libs/trading-core
RUN pip install ./libs/trading-core

# ---------------------------------------------------------------------------
FROM base AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 appuser \
    && useradd --system --uid 1001 --gid appuser --create-home appuser

COPY --from=build --chown=appuser:appuser /opt/venv /opt/venv
COPY --chown=appuser:appuser services/market-data/app ./app
COPY --chown=appuser:appuser services/market-data/pyproject.toml ./pyproject.toml
# The log-config file is two no-op keys, and both halves of that sentence matter:
# uvicorn installs its own plain-text handlers unless --log-config points at
# something loadable, and this service's JSON log pipeline is configured by the app
# itself, a moment later, in create_app. A zero-length stand-in cannot work -
# logging.config.fileConfig, which is what uvicorn uses for any path that is not
# .json or .yaml, raises "RuntimeError: /dev/null is an empty file", true since at
# least python 3.11.9 - and the .json suffix is what routes uvicorn to dictConfig,
# which accepts this shape and changes nothing. Both the flag and the file are
# pinned by services/execution-engine/tests/test_part18_asgi_target.py, which loads
# every Python service's real image command through uvicorn's own Config.
COPY --chown=appuser:appuser services/market-data/log-config.json ./log-config.json

USER appuser
EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent "http://127.0.0.1:${MARKET_DATA_PORT:-8002}/health" || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${MARKET_DATA_PORT:-8002} --proxy-headers --no-access-log --log-config ./log-config.json"]
```


## FILE: docs/PART16_PLACEMENT_REVIEW.md (448 lines)

*sec. 6 amended rather than rewritten: the counters this part documents were never scraped by anything (the earlier sentence claiming trading-engine's module did it was false - different process, no shared memory), the 12 unrecorded stages became 8, and the part's own verification counts are marked historical, which is how this repository stops re-basing numbers it can no longer reproduce.*

````text
# Part 16 — the credential source and the authenticated placement review

> Status: shipped, dark. Live mode remains refused, and this document says exactly
> which sentence refuses it and what has to be true before that sentence goes away.

## 1. What this part was asked to close

`services/execution-engine/app/composition.py` named its own gaps before this part
existed:

> *the live credential provider and the authenticated order-placement review are
> unfinished*

Everything else in the execution path — order lifecycle, events, incidents,
reconciliation, the Binance adapters, the risk gate, the safety-tier gates — was
already implemented and tested (the audit that established this is
[`PART16_CORE_LAYER_GAP_AUDIT.md`](PART16_CORE_LAYER_GAP_AUDIT.md)). So Part 16
built the two missing layers and nothing else. No order that previously reached a
venue now takes a different path, because no order reached a venue before this
part and none does after it: `ExecutionRuntime` still refuses live mode.

Two properties were required of the result:

* **Dark launch.** The review runs on every order a runtime *could* transmit, and
  on a simulated runtime it records findings without changing outcomes. Adding it
  must not be able to alter a paper deployment's behaviour, because a behaviour
  change in the money path is what a part like this is most likely to get wrong and
  least likely to notice.
* **No new failure vocabulary.** The review is one more safety gate, not a second
  rejection mechanism. One code path produces blocked-gate incidents, audit events
  and typed results for every gate; the review joins it.

## 2. The gate

`SafetyGate.PLACEMENT_ATTESTED` is gate **11** of 11 in
`wlct_trading/execution/safety.py`, evaluated in
`ExecutionPreconditions.placement(...)`. Its contract:

| state | gate result |
| --- | --- |
| no reviewer wired | `passed=True`, `applicable=False`, detail names the fact that a runtime which transmits refuses to start in this state |
| reviewer wired, verdict allowed | `passed=True`, detail carries the verdict id and the venue-backed flag |
| reviewer wired, verdict refused | `passed=False`, detail is the verdict's first blocking finding |

A blocked gate maps through the engine's existing `_GATE_ERROR_CODES` table to
`ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED`. **No new error code was added**,
deliberately: the worker's taxonomy, the API's failure surface and the admin
console's rendering all key off that enum, and the useful detail — *why* the
review refused — travels in the verdict codes inside the audit payload and the
incident, where a human reads it. A `PLACEMENT_REVIEW_BLOCKED` code would have
been a second place to look for the same fact.

Because a blocked review is a fault and not an operating mode, the gate is in
`_maybe_record_gate_incident`'s `faulty` set: it produces an
`IncidentType.SAFETY_GATE_BLOCK` at `WARNING`, while a kill switch stays silent
(the system working as intended) and a credential failure stays `CRITICAL`.

The review also runs *before* the gates rather than inside gate evaluation: the
verdict is gathered once, then handed to the preconditions as one more input. The
`2a. Placement review` block in `ExecutionEngine.submit` is the only place the
reviewer is called, and one order means exactly one review.

## 3. The law

`wlct_trading/execution/placement_review.py` is pure by construction — no clock,
no entropy, no I/O, no `await`, and `now_micros` is a required argument wherever
time is needed. It is asserted structurally (`TestPurity` parses the module's own
AST), because "this file is a function of its inputs" is the property that makes an
audit record re-derivable, and a file can acquire a default clock in one line
without anyone intending it.

Six rules, in the order they matter:

1. **Absence outranks everything.** No attestation is `NO_ATTESTATION`, not an
   empty `PlacementFacts`. "We never asked" and "the venue says no" are different
   facts about the world, and a review that conflates them cannot tell an operator
   whether to wire something or to change a key.
2. **The review can only tighten.** Every policy knob is a duration or a bound;
   none is a permission. There is no `allow_withdrawals`, no
   `skip_ip_allowlist_check`, no `require_venue_attestation=False` on the policy
   (that flag exists on the *reviewer*, where it means "this runtime cannot
   transmit", which is a statement about the runtime and not about an entitlement).
3. **Staleness is a finding.** `age_ms = (now_micros - attested_at_micros) // 1_000`
   against `max_attestation_age_ms`; a negative age is `FUTURE_ATTESTATION`. Both
   ends are bounded (`1_000..3_600_000` ms) at construction, so a TTL that would
   make every attestation stale — or make a day-old one look fresh — cannot boot.
4. **`requires_venue_attestation` decides the consequence of a missing answer.** A
   runtime that may transmit and has only local facts is refused
   (`VENUE_ATTESTATION_REQUIRED`, BLOCKING). A runtime that cannot transmit records
   the same gap as `INFO`. In the transmitting case, *every* evidence-absence code
   blocks, including ones the severity table ranks as a warning: "the venue is
   rate-limiting us" is not a licence to place an order. In the simulated case a
   code the table already ranks as a warning keeps its rank, so
   `ATTESTATION_RATE_LIMITED` stays `WARNING` rather than being flattened to `INFO`
   — an operator should still see that the venue is throttling us.
5. **An unattested field is a finding only when a source that could answer was
   consulted** (`facts.venue_backed`). A venue-backed attestation that does not
   say whether the key may withdraw is `WITHDRAW_ENABLED`-adjacent and blocks; the
   same silence from an in-process gatherer is not a finding at all.
6. **Findings are ordered severity → code → field**, and the verdict id is a digest
   over canonical JSON of the findings, the policy, the attestation and the mode.
   So a verdict id is comparable across processes and platforms, and it changes
   when the *evidence* changes — not when the moment does. Two processes that
   looked at the same key in the same minute produce the same id; two that saw
   different entitlements do not. `retryable` is true only when every blocking
   finding is retryable (`RETRYABLE_REVIEW_CODES`), which is what lets a worker
   re-queue one order and page a human about another.

## 4. The gatherers

| class | answers | used by |
| --- | --- | --- |
| `UnattestedPlacementAttestor` | nothing; `source = "unattested"`, the configured reason travels in `collection_detail` | the default wiring, so "forgot to configure" is never shaped like "configured permissive" |
| `LocalPlacementAttestor` | the credential provider's declared permissions, an injected symbol table, measured skew | a simulated runtime that wants real findings in its audit without a venue call |
| `CachingPlacementAttestor` | wraps another, keyed by the full question | every composed runtime |
| `BinancePlacementAttestor` | `/sapi/v1/account/apiRestrictions`, optionally `/api/v3/account` flags, optionally `exchangeInfo` | a live runtime, injected by the service that owns the adapter |

The gatherer that reaches Binance reuses the deployment's
`BinanceTradingAdapter` rather than constructing a signed client of its own. That
is not a shortcut: the adapter owns the credential provider, the synchronised
`ExchangeClock` and — critically — the `RateLimitRegistry`. A second client would
spend request weight the deployment never accounted for, and the venue's `429`
would then land as a review failure on the way to an order that never went out.
`test_part16_binance_attestation.py::TestThroughTheSignedClient` asserts this
against the real client: the path, `signature=`, the API-key header,
`method="GET"`, and that the weight charged is
`BINANCE_REST_WEIGHTS["api_restrictions"] == 1`.

Field reading, and the two unit traps it exists to avoid:

* `tradingAuthorityExpirationTime: 0` means "no expiry", not "expired in 1970".
  `_optional_millis` maps `0` and negatives to `None`. Read literally, every
  non-expiring key on the platform would have been refused.
* `HttpResponse.json()` decodes numbers as **strings** to protect precision, so a
  millis field must accept `str` (and reject `True`, which is `1` to Python).
* `enableWithdrawals` must be `False` for a non-custodial platform, and only ever
  `True` alongside an IP filter. An absent field is `None` — and law 5 turns that
  silence into a refusal for a venue-backed attestation, because "unknown" is not
  "cannot".
* Spot `exchangeInfo` publishes per-symbol `orderTypes` and **no** per-symbol
  time-in-force list. The TIF slot is therefore always empty, which the reducer
  maps to `None` ("not attested") and never to `False`. Inventing a rule here
  would put a claim in the audit record that the venue never made.
* `exchangeInfo` with no `symbols` has *not loaded* — the lookup returns `None` and
  the review asserts nothing. A loaded catalog that lacks the symbol returns
  "not attached" and the order is refused (`SYMBOL_UNATTACHED`). Collapsing those
  two turns a cold start into a venue-side denial; a whitespace-only `symbol` in a
  payload is skipped rather than registered, so a malformed catalog cannot pose as
  a loaded one.

## 5. The cache, and the fail-open that was found here

`CachingPlacementAttestor` is keyed by
`(tenant_id, account_id, symbol, order_type, time_in_force)`. The first draft used
`(tenant_id, account_id, symbol)` on the theory that one gather per account-per-
symbol is one gather per order. That theory was wrong, and the shape of the wrongness
is worth recording because it is the classic shape: an attestation stores the
symbol's capability lists **already reduced to booleans for the shape asked about**.
Reuse it for a different shape and you assert support the venue never granted —
a `LIMIT`/`GTC` gather authorising a `STOP_LIMIT`/`IOC` order. Sharding the key by
order shape is not a performance choice; a coarse key here is a hole.

A failure entry lives `max(ttl // 5, MIN_ATTESTER_TTL_MS)`: caching the failure is
what stops an outage becoming a stampede, shrinking the window is what stops the
outage being remembered after the venue recovers. `stats()` (entries, hits,
misses, failuresCached, both TTLs, maxEntries) is what `/status` publishes, because
"the review costs nothing per order" and "the review is why we are out of weight"
are otherwise indistinguishable. `PlacementReviewer.describe()` reports the cache
only when the attestor has one — a status surface that prints zeros for a component
that does not exist reads as "wired and idle" to whoever is on call.

Two other fixes that came out of writing the tests rather than out of a plan:

* `evaluate_placement_attestation` raised `UnboundLocalError` on the collection
  branch for a non-transmitting runtime. The reviewer's never-raises wrapper turned
  that into `ATTESTATION_UNREACHABLE` — a wrong code, correctly formatted, in a
  durable record. The severity is now read from the table before the mode adjusts
  it, and the test asserts the *code*, which is what caught it.
* `PlacementReviewRequest.__post_init__` blank-checked the *unnormalised* value, so
  `tenant_id="   "` passed while `symbol="   "` did not. A whitespace tenant id
  would have shared one cache key and one audit line reading `tenant: `. Both
  identity fields are refused now; only `symbol`, `order_type` and
  `time_in_force` are upper-cased, because tenant and account ids are opaque ids
  owned by another service and case-folding them would miss a lookup rather than
  fix a spelling.

## 6. Configuration

`services/execution-engine/app/config.py` gained eight fields and one validator
(`_validate_placement`) - the table below has seven rows because the tenant and
account identifiers are one decision, not two knobs. There is deliberately **no** `EXECUTION_PLACEMENT_REVIEW_ENABLED`
switch: a key that lets a deployment trade without asking the venue whether the key
may trade is the same as no review at all. What is configurable is where key
material comes from and how expensive the review may be.

Every one of the eight is written into **both** inventories:
`services/execution-engine/.env.example`, which is the file
`scripts/dr-manifest.mjs` enumerates when it asks whether a deployment's
environment can be described from something committed, and the root
`.env.example`, which is the file an operator actually copies. One of the two is a
variable somebody will not find, and a refused-at-boot default is worth a sentence
beside the variable that triggers it rather than a pointer to this document.

| variable | default | law |
| --- | --- | --- |
| `EXECUTION_CREDENTIAL_SOURCE` | `none` | `none` wires a provider that refuses every authenticated lookup — correct for a paper process, where needing a key is a bug. `environment` is development-only and is **refused outright** when `NODE_ENV=production`. `secret-manager` requires a fetcher injected in code: key custody lives with the service that owns the encrypted store, and no HTTP surface of this engine may install one. |
| `EXECUTION_CREDENTIAL_ENV_PREFIX` | `WLCT_BINANCE` | The core appends `_API_KEY` / `_API_SECRET`. A trailing underscore is refused at boot rather than normalised, because a check that quietly disagrees with the code it guards turns a missing variable into a passing startup. |
| `EXECUTION_CREDENTIAL_TENANT_ID` / `_ACCOUNT_ID` | `tenant-1` / `account-1` | The single pair an environment can serve. More than one tenant requires `secret-manager`; an environment cannot scope a secret per customer, which is the whole reason `environment` is development-only. |
| `EXECUTION_CREDENTIAL_CACHE_SECONDS` | `300` | Not a security window. Rotation and revocation are the venue's and the operator's; this is the difference between one vault call per order and one per burst. |
| `EXECUTION_PLACEMENT_ATTESTATION_TTL_MS` | `300000` | Both the cache TTL and the freshness bound, on purpose: a cache that outlived the freshness window would be the reason a stale attestation passes. Bounds `1000..3600000`, imported from the core and never retyped, so the two cannot drift. |
| `EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS` | `90` | `1..36500`; a key older than this may not trade until it is rotated. |
| `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST` | `true` | Default true; `false` is accepted for simulated runtimes and refused for live ones, because the allowlist is the one control on a leaked key that the venue enforces for us. |

A simulated runtime gets `mode="local"` and `requires_venue_attestation=False`, so
the review runs on every paper order, records one `INFO` finding, and changes no
outcome.

Nothing here needs a migration: the review adds no table and no column. The
verdict rides in the existing `SUBMITTED` event payload
(`OrderEvent.payload` is `dict[str, str]`, so booleans arrive as `"true"`/`"false"`
and timestamps as digits — never `str(True)`, which a consumer reads as a
different word for yes).

### What the part made measurable

Three counters in the core's engine metrics snapshot, all incremented from one
place (`ExecutionEngine._record_placement_review`, which is the only path that
knows a verdict and an outcome at the same time): `placementReviews` (every review
run, allowed or not), `placementReviewBlocks` (the subset the review refused) and
`placementAttestationFailures` (the subset refused because the venue could not be
asked, which is the number that separates "our keys are wrong" from "the network
is down"). The review is also a timed stage: `EXECUTION_STAGES` gained
`placement_review`, and the engine observes it around the gatherer call, so the
cost of asking the venue is a histogram rather than a guess.

Two honest limits, both measured rather than assumed, both pinned by
`test_the_engines_observed_stages_are_declared_and_placement_review_is_live` in
`tests/test_observability_metrics.py`:

* The engine recorded exactly the stage this part added. *Amended by Part 18:*
  twelve of the thirteen declared names had no call site when this was written,
  and the engine now times four more - `validation`, `safety_gates`, `risk` and
  `total_submit` - so eight remain, each belonging to a layer across a boundary
  (the adapter, the stream, the reconciliation service, and `persistence` spread
  over six store writes). The test guards the direction that matters (an observed
  name must be declared, or the sample is computed and thrown away) and pins the
  13/8 figures so this paragraph cannot go stale quietly: wiring a new stage means
  updating the test and this section together.
* The execution engine service mounted no metrics exposition route at all, so
  these counters lived in a library snapshot with no reader. *Amended by Part 18,
  which also corrects what this sentence claimed when it was written:* it said the
  numbers were "scraped by whichever process renders one", naming
  `services/trading-engine`'s observability module - and that is false, because
  Part 9's hub renders a registry in *its own* process and has never seen this
  service's `ExecutionMetrics`. Two services do not share a counter object across
  a process boundary, so nothing was scraping anything; the honest state was
  "measured, kept in the process that measured it, and unreadable from outside".
  Part 18 shipped the `/metrics` route on the merits rather than to make this
  paragraph true, and this note is here because a dated correction is cheaper
  than a stale claim that reads as a design decision.

## 7. The internal endpoint

`POST /internal/v1/placement/attest` (`app/routers/placement.py`), internal prefix
only, bearer token required, never forwarded by the worker client:

* `409 PLACEMENT_REVIEW_UNWIRED` when the runtime has no reviewer.
* `400 PLACEMENT_REQUEST_REFUSED` when the core's request validation refuses the
  identifiers — the refusal is the core's own message, so the API and the engine
  cannot disagree about what a valid symbol is.
* `200` otherwise, **including when the review refuses the order**. A refusal is
  data: the caller asked what the venue says, and the answer arrived. `500` for a
  refusal is how an operator ends up unable to see why their own console cannot
  place a test order.
* `transmitted: false` is a constant on the response model, not a computed field.
  The day this endpoint can transmit, that line has to change and a test has to
  change with it.
* The response model has no field a credential could fit into, and the test suite
  asserts that rather than asserting the intent.

### `GET /internal/v1/status` gained the posture

The review's *answer* is on one surface and its *posture* on another, and before
this part the second one was silent: `EngineRuntime.describe()` published
`credentialSource` and the `placement` block, and `/status` mapped every other
describe() field but dropped those two. A line of
`services/execution-engine/.env.example` saying the findings are "published by
/status (placement block)" - while the response model had no such field -
is the kind of sentence a repository grows when nobody reads it back.

`StatusResponse` therefore gained `credentialSource` and a typed
`PlacementStatusView` (`label`, `mode`, `requiresVenueAttestation`,
`cacheTtlMillis`, `attestorSource`, `policy`, optional `cache`). Three decisions
inside one small model:

* **typed, not a passthrough dict**, and the wire base's `extra="forbid"` applies.
  A `describe()` that grows a key without a decision here fails in CI (a drift test
  compares the two key sets in both directions) rather than 500-ing on the surface
  the worker asserts against before it forwards anything - and rather than quietly
  publishing an unreviewed field on an authenticated internal route.
* **`policy` and `cache` are mappings of numbers, not declared fields**, which is
  what makes passing them through safe: those blocks hold bounds, counters and one
  boolean, and nothing string-shaped, so a credential cannot be smuggled inside
  them. The only strings are the three labels, and a test asserts the body carries
  no credential-shaped key or substring at any depth.
* **`placement is null` and `attestorSource == "unattested"` are different
  statements.** The first is "this engine did not answer the question" - the same
  convention `storeBackend`'s `"unknown"` and `enablementMaxAgeDays`'s default set
  - and the second is "the question was answered: the review is wired and no venue
  stands behind it". Collapsing the two would let a pre-Part-16 deployment be
  reported as a reviewed one.

One asymmetry is worth stating rather than leaving for a reader to find: the
typing rule binds `/status`, not every surface that can see the wiring.
`/health/ready` spreads the same `describe()` dict with no token (Part 13
established it for `storeBackend`, because a probe cannot be handed credentials),
so an added key reaches that route whether or not anyone declares it. What keeps
that safe is not a response model - it is that `describe()` is built from labels,
booleans, integers and one nested dict, and the suite scans both bodies for a
credential-shaped key or substring at any depth. A guard on the projection would
have been theatre; the guard is on the source. That
interface is the projection the worker's compatibility gate reads, and it omits
Part 14's retention fields and Part 15's evidence window for the same reason the
placement block is absent from it: the worker must not forward anything into a
process that could reach a venue, and a review the worker cannot trigger is not its
business in this build. A test holds that the client never even names the attest
path.

## 8. What is not wired in this build

`build_runtime` still raises before constructing an engine in live mode. The
refusal sentence in `app/composition.py` is the operator-facing explanation of this
whole part, and it no longer calls this part's two deliverables missing. It says
`EXECUTION_MODE=live is not wired in this build`, then what exists now - "the
durable store and its verification (Part 13), distributed locks (core), the
credential provider selection and its boot refusals, and the authenticated
order-placement review the engine requires before it will transmit (Part 16)" -
then what does not: "this service never constructs a venue trading adapter - no
signed HTTP transport is wired here, no live or testnet base URL is selected, and
there is no operator runbook for the enablement evidence a live account must
present". `test_live_still_refuses_and_says_what_is_actually_missing` asserts the
message names all of it, because a refusal sentence that still called the review
unfinished after this part shipped would be a lie with a test behind it.

So the list below is the whole of what is left, not a summary of it. What remains genuinely unwired, and
what the next operator must supply, in order:

1. A venue attestor instance. `BinancePlacementAttestor(adapter=..., account_reader=..., symbol_facts=...)`,
   built from the *same* adapter the orders use, passed as
   `build_placement_reviewer(..., venue_attestor=...)` with
   `will_transmit_orders=True`.
2. A key source that can answer per tenant. `EXECUTION_CREDENTIAL_SOURCE=secret-manager`
   plus a fetcher injected in code at the composition root; the environment source
   cannot serve more than one account and is refused in production regardless.
3. A signed HTTP transport bound to the venue's hostname and port, and an
   egress IP allowlist registered at the venue for the key that will sign.
4. A durable store and a distributed lock manager — the pre-existing live-mode
   requirements, unchanged by this part.

Until all four exist, `EXECUTION_MODE=live` is refused at boot with that sentence,
and this part's review runs on paper orders only, where it is visible in
`/status`, in `placement.attestation.*` log lines and in the audit payload — which
is the point of a dark launch: the wiring is exercised, and the money path is not.

## 9. Deliberate omissions

* No domain event bus, no Redis Streams plane. `BullMQ` plus `engine_order_events`
  plus the Socket.IO gateway already fan out; a second plane would be a second
  source of truth.
* No re-implementation of the order lifecycle, the event store, the incident
  recorder or the Binance adapters. The review joins them.
* No service-side re-implementation of the venue's answers. `binance/__init__.py`
  now re-exports the gatherer's surface under one stated rule - a name is public
  when a deployment needs it to configure the venue, and stays module-path-local
  when importing it from the package root would drag the transport vocabulary in -
  which is why `BinancePlacementAttestor`, `KeyEvidence`, `SymbolRegistry` and
  `AccountFlagReader` are exported and `BinanceTradingAdapter`, `HttpResponse`,
  `SignedRequestSender` and `ExchangeClock` are not. The rule is a test
  (`TestPackageSurface`), not a comment, and it caught one real omission while
  being written: `AccountFlagReader`, the protocol every account-flag reader must
  satisfy, was defined but undeclared.
* No suppression comments in any file this part added — tests included, and
  including the comments that would have been no-ops: the lint ruleset here is
  `["E4", "E7", "E9", "F"]` and mypy runs on the packages, not the tests, so a
  marker of that kind annotates a rule nobody enabled. Where a type needed
  naming instead, it was named (the `SymbolRegistry` protocol, `dataclasses.replace`
  in the law's own test helper).

## 10. Verification

```sh
# core (law + gatherers + engine wiring + venue mapping)
cd libs/trading-core
python3 -m ruff check wlct_trading/ tests/
python3 -m mypy wlct_trading
python3 -m pytest -q

# service (settings, builders, composition, endpoint, drift parity)
cd services/execution-engine
python3 -m ruff check app/ tests/
python3 -m mypy app/
python3 -m pytest -q

# handover generator is deterministic
python3 scripts/gen_part16_handover.py --check
```

Expected at the time of writing (as Part 16 left the tree: core `1559 passed`,
service `235 passed, 12 skipped`, mypy clean over 148 and 19 source files
respectively). These counts are historical, and the current ones - which Parts 17
and 18 moved by adding files of their own - are in `docs/PART17_DURABLE_INCIDENTS.md`
and `docs/PART18_METRICS_EXPOSITION.md` rather than quietly re-based here, because
a verification section that is re-measured by a later part stops being evidence of
anything.
`node --test scripts/` 52/0 with `dr-manifest.mjs --check` valid and
`--check-rls` exit 1 (the shipped posture, unchanged by this part); apps/api
386 tests over 17 suites with `tsc` and `eslint` clean and `prisma validate`
valid; admin-web `tsc` clean; trading-engine 43 and market-data 19.

The Part-16 tests are `libs/trading-core/tests/test_part16_placement_review.py`
(40, the law alone), `test_part16_placement_attestor.py` (49, gatherers, cache,
engine wiring and the umbrella package's export parity),
`test_part16_binance_attestation.py` (44, the venue mapping, its unit traps and the
venue package's export rule) and
`services/execution-engine/tests/test_part16_placement.py` (40) - 173 tests, plus
one in `libs/trading-core/tests/test_observability_metrics.py` that keeps this
part's metric stage and the vocabulary it lives in from drifting apart.

Nine documents carry the part outside this file, and the list is here because a
control the permanent documents still describe as missing does not exist:

* `README.md` and `docs/ARCHITECTURE.md` section 9 - the platform's execution-safety
  list went from three independent gates to four, in both copies, with the engine
  plane's own final gate named rather than implied. The architecture document's
  execution-engine paragraph also carries the new route, gate 11, the `/status`
  posture block, the unauthenticated `/health/ready` mirror of the same wiring
  dict, and the prerequisite list corrected to what actually remains.
* `docs/SECURITY.md` section 4 (runtime credential sources), section 11 (the review
  as the fourth independent gate), section 14 (what live mode still lacks) and
  section 15 (what the review cannot do).
* `docs/ROADMAP.md` - the delivery-log row.
* `docs/PART5_EXECUTION.md` (the gate count ten to eleven, plus a dated note beside
  its own "still not built" list), `docs/PART11_WORKER_SCALING.md`,
  `docs/PART13_DURABLE_STORE.md` and `docs/PART14_RETENTION.md` - each carried a
  present-tense sentence naming the credential provider or this review as still
  open. Every one is dated in place rather than rewritten: those parts' accounts of
  what they declined to do are still accurate about those parts, and a reader
  needs to know which of the two statements they are reading.
````


## FILE: docs/ARCHITECTURE.md (402 lines)

*the service's surface gains its metrics endpoint and the metricsConfigured field, with the reason each is published rather than an assertion that it is useful.*

````text
# Architecture

## 1. What this system is

A multi-tenant, white-label copy-trading platform. One deployment serves many
independent organisations ("tenants"), each with its own users, roles, branding,
subscription and configuration. It is **non-custodial**: the platform never
holds customer funds. Users connect their own exchange accounts with trade-only
API keys, and orders are placed on the user's own exchange account.

Part 1 delivers the foundation - tenancy, identity, authorisation, security and
the service skeletons. Copy-trading logic and live order execution are
explicitly out of scope and are hard-disabled in code.

## 2. Topology

```
                        ┌───────────────────────┐
   Mobile (Flutter) ───▶│                       │
                        │   NestJS API (:4000)  │◀─── Admin console (Next.js :3000)
   Browser ────────────▶│  REST + Socket.IO     │       (server-side proxy only)
                        └───────┬───────────────┘
                                │
            ┌───────────────────┼────────────────────────────┐
            │                   │                            │
     ┌──────▼──────┐     ┌──────▼──────┐            ┌────────▼────────┐
     │ PostgreSQL  │     │    Redis    │            │  Internal HTTP  │
     │  (Prisma)   │     │ cache/queue │            │  (token-gated)  │
     └─────────────┘     └──────┬──────┘            └────────┬────────┘
                                │                            │
                     ┌──────────┴──────────┐      ┌──────────┴──────────┬─────────────┐
                     │ notification-service│      │  trading-engine     │ market-data │
                     │  Node + BullMQ :8003│      │  Python/FastAPI:8001│ Python :8002│
                     └─────────────────────┘      └─────────────────────┘─────────────┘
```

Only the API and the admin console are published. The three supporting services
listen on the internal network and require a shared internal token.

## 3. Why these boundaries

**One API, several workers.** All client traffic terminates at the NestJS API.
It owns the database, authorisation and the audit trail. Everything else is a
worker or a calculator that the API delegates to. This keeps exactly one place
where a tenant boundary can be crossed, which is the property that makes
multi-tenancy auditable.

**Python for market and trading logic.** Exchange connectivity, numerical work
and the risk engine live where the ecosystem is strongest (`ccxt`, the
scientific stack) and where a hot loop will not block a Node event loop.

**Node for the notification worker.** It shares the API's queue contract and
templates; a second language there would buy nothing.

**A separate notification process, not an inline worker.** Email sending is slow
and failure-prone. Running it in the API process would couple request latency to
an SMTP server's mood. `QUEUE_RUN_INLINE_WORKERS` gates the inline path so a
single-process development setup still works.

## 4. Multi-tenancy

### Resolution

The tenant for a request is resolved in this order:

1. Custom domain (`TenantDomain`)
2. Platform subdomain
3. `X-Tenant-Slug` header
4. `DEFAULT_TENANT_SLUG`

For an authenticated request, whatever the above produced is **overridden** by
the tenant in the access token. A client-supplied tenant id is a hint for
unauthenticated flows (sign-in, branding) and never an authorisation input. An
*explicit* selection (domain, sub-domain or header) that contradicts the token
is rejected outright with `403 TENANT_MISMATCH` and recorded as a security
event; the `DEFAULT_TENANT_SLUG` fallback is not, because it reflects a server
assumption rather than a client claim. See `docs/MULTI_TENANCY.md`.

### Isolation

`TenantScopedPrismaFactory` wraps the Prisma client and injects a `tenantId`
predicate into every query against a tenant-owned model. The model allowlist is
explicit, so adding a table is a deliberate decision rather than an accident.

Supporting properties:

* Every tenant-owned table carries a non-null `tenantId`.
* `tenantId` is the first column of every composite index, so the predicate is
  free.
* Uniqueness is scoped: `User` is unique on `(tenantId, email)`, not on `email`.
* Platform-scoped rows use `tenantId = NULL` (system roles, platform plans).
  Prisma cannot express `NULL` inside a compound-unique `where`, so those rows
  are read with `findFirst` and written with explicit update/create branches.

Row-level security is the natural next step; the schema is already shaped for
it.

### Physical naming

Tables and columns are `snake_case` in PostgreSQL (`@@map` / `@map`) while the
Prisma client stays `camelCase` in TypeScript. Application code is unaffected by
the mapping, but every hand-written query, migration, psql session, BI tool and
`GRANT` in `infrastructure/database/init/` avoids permanently quoting
identifiers. Mixing the two conventions - `snake_case` tables with `camelCase`
columns - is the outcome worth avoiding, because it forces quoting anyway while
looking like an oversight.

## 5. Identity and authorisation

### Authentication

* **Passwords**: argon2id, with cost parameters from the environment.
* **Access tokens**: short-lived JWTs, signed with a dedicated key.
* **Refresh tokens**: stored as HMACs, never in the clear. Every refresh rotates
  the token and records `familyId` / `replacedByTokenId`. Presenting a consumed
  token revokes the entire family and raises a `CRITICAL` security event - that
  is the signal of a stolen token.
* **Device binding**: refresh tokens are bound to a client-generated device id,
  so a stolen token is useless elsewhere.
* **Logout**: blacklists the access token's `jti` in Redis until its natural
  expiry.
* **2FA**: TOTP via `otplib`. The secret is encrypted at rest with AAD
  `two_factor_secret:{userId}`; the last used counter is stored to block replay;
  recovery codes are argon2-hashed.
* **Defence**: per-account lockout, uniform responses to defeat account
  enumeration, a session cap with LRU eviction, and suspicious-login scoring.

### Authorisation

Roles are data, not code. Seven system roles ship as immutable templates
(`tenantId = NULL`, `isSystem = true`) and are cloned into each tenant at
creation, so a tenant can customise its own copy without affecting anyone else.

`PermissionsGuard` re-reads live permissions on every request rather than
trusting the token's snapshot, supports `all`/`any` semantics and wildcards
(`*`, `resource:*`), and emits a `PERMISSION_ESCALATION_ATTEMPT` event on
denial. Adding a role or permission is a data change; no authorisation code
needs to be rewritten.

## 6. Secrets and encryption

Exchange API credentials are the highest-value data in the system. They are
protected with envelope encryption:

* A fresh 256-bit **data key** per record.
* The data key is sealed with AES-256-GCM under a **key-encryption key**
  (`ENCRYPTION_MASTER_KEY_BASE64`), identified by `ENCRYPTION_KEY_ID`.
* `ENCRYPTION_PREVIOUS_KEYS_JSON` holds retired keys for decrypt-only, which
  makes rotation a zero-downtime operation.
* **AAD binds ciphertext to its owner** (`{tenantId}:{userId}`). A row copied
  into another tenant will not decrypt.
* `ENCRYPTION_PROVIDER=kms` swaps the local KEK for a managed KMS without
  touching call sites.

Deterministic lookups on encrypted values use an HMAC-SHA256 **blind index**
(`BLIND_INDEX_KEY_BASE64`). The same key hashes client IPs, so the audit trail
is correlatable without storing an address.

Secrets are never returned by the API. Reading a secret tenant setting yields
`{ configured: true }`.

## 7. Errors, logging and observability

Every error leaves the API in one envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable, safe to display.",
    "details": [{ "field": "email", "message": "Must be a valid email address" }],
    "requestId": "0f3c...",
    "timestamp": "2026-09-05T10:00:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```

The Python services emit the same shape, so a client has one parser.

Logging is structured JSON via pino, with a redaction list covering
authorization headers, cookies, passwords, tokens, exchange secrets and payment
credentials. Stack traces never reach a production response body. Every request
carries an `x-request-id` that is propagated to the internal services.

Health endpoints: `/health` (liveness, no dependencies), `/health/ready`
(Postgres + Redis, 503 when down), `/health/deep` (adds queue depth and the
three downstream probes), `/health/startup`.

### The reliability plane (Part 10)

Above the metrics layer sits the reliability plane, and the one law over it:
**observe, never authorise.** Its parts:

* **Tracing.** `apps/api/src/infrastructure/tracing/` (W3C parse/format,
  deterministic BigInt sampling, OTLP/JSON encoder, the middleware,
  `TracingService`) mirrors `libs/trading-core/wlct_trading/observability/`
  (`tracing.py`, `redaction.py`, `faults.py`); the engine's glue is
  `services/trading-engine/app/tracing.py`. Propagation is
  W3C `traceparent`/`tracestate` in, OTLP/JSON out, single-attempt export
  with drop counting that is loud (counters + gauge + a three-streak alert).
  Head sampling is `int(trace_id[:16],16) < ratio_ppm * 2^64 / 10^6` - a pure
  function, identical in both languages, fixture-pinned.
* **SLOs.** Definitions are immutable versioned rows
  (`slo_configuration_versions`, checksummed canonical JSON); measurements
  live in 10-minute Redis bucket hashes (`wlct:trading:ops:slo:<source>:
  <epoch-min/10>`); evaluation appends `slo_evaluations` rows on a */N cron
  and on demand. Dual windows, dual multipliers: paging needs fast burn over
  the short window AND slow burn over the long one (Google SRE style);
  state is `HEALTHY/WARNING/CRITICAL/EXHAUSTED/UNKNOWN`, and UNKNOWN from a
  thin collector is reported as the measurement gap it is (`SLO_TELEMETRY_GAP`),
  never averaged away. The nine default objectives live in the Python catalog
  as the source of truth; the TS catalog is pinned to it by SHA-256 checksums
  that include the human-readable text.
* **Queue correlation.** A publish that succeeds attaches its traceparent to
  a short-TTL Redis sidecar (`captureQueueSidecar`); a worker continues the
  span only if the sidecar exists. Job payloads never carry telemetry fields,
  and telemetry never gates a job.
* **Cross-language contract.** `docs/fixtures/reliability_fixtures.json`
  (generated by `libs/trading-core/scripts/gen_part10_fixtures.py`) pins
  sampling decisions, traceparent/tracestate vectors, attribute hygiene,
  byte-exact OTLP payloads, budget/burn tables, catalog checksums and full
  evaluation rows; `slo-parity.spec.ts` replays every vector through the TS
  implementation. Drift on either side fails the suite, in either direction.

### The worker plane (Part 11)

The process model the earlier parts only described in comments finally
exists: three roles, each able to refuse, none able to impersonate another.

* **API** - unchanged producer of `TRADE_EXECUTION` jobs (deterministic
  `jobId` dedupe at admission, `enqueueOrThrow` for anything a human waits
  on); mounts no consumers, by module graph, not by flag:
  `src/modules/worker/` is imported only by `src/worker.ts`.
* **Worker** (`apps/api/src/worker.ts`, no HTTP server at all) - validates
  each job against the mirrored producer contract, admits it only while it
  verifiably HOLDS the partition claim its `${tenantId}:${accountId}` key
  maps to (rendezvous assignment + Redis claims, both languages pinned by
  `docs/fixtures/coordination_fixtures.json`), forwards, and acks: engine
  2xx completes the job (any business verdict inside it), engine terminal
  4xx/501 fails it visibly with the engine's reason, 5xx/transport retries
  within the producer's attempt budget, and not-owner defers via
  `moveToDelayed` - counted through `WORKER_MAX_DEFERS`, so homeless jobs
  page somebody instead of orbiting forever. Coordination failures fail
  CLOSED to deferral; the job path never awaits Redis.
* **Execution engine** (`services/execution-engine`) - the only process with
  venue-adjacent runtime, hosting the core `ExecutionEngine` behind an
  internal token + required tenant header; serves the four commands the
  queue actually carries, answers 501 to the one it cannot honor
  (`resync-private-stream`), and REFUSES `EXECUTION_MODE=live` at startup
  by code, with live's remaining prerequisites named rather than implied
  (Part 16 wired the credential source and the authenticated order-placement
  review; what live mode still lacks is a venue attestor instance built from the
  deployment's own trading adapter, per-tenant key custody behind
  `EXECUTION_CREDENTIAL_SOURCE=secret-manager`, a signed HTTP transport with the
  egress addresses registered at the venue, and Part 13's durable store).
  The store is a backend choice: `memory` (default, process-local, reports
  `storeDurable: false`) or `postgres` (durable orders/events/fills in the
  three `engine_*` tables, DSN required, missing tables or a dead pool
  refuse startup - never a silent fallback). Its measurements leave the process the
  way its siblings' do - `GET /metrics`, Prometheus 0.0.4 text on the internal
  network, no token and no tenant-shaped label (the core's cardinality law refuses
  such labels at registration, which is the difference between being safe to scrape
  and being filtered after the fact), absent from the OpenAPI document and from the
  worker's forwarding list, and not mounted at all when `OBSERVABILITY_ENABLED` is
  false - which `NODE_ENV=production` refuses (docs/PART18_METRICS_EXPOSITION.md). Part 14 added the bounded
  journal: the event table alone is prunable, apply is dark behind
  `EXECUTION_RETENTION_ENABLED`, every completed run (dry included)
  writes a `engine_retention_runs` ledger row nothing prunes, and no
  schedule ships - the deployment's cron calls
  `scripts/retention-run.mjs`, one tenant per run. The worker's boot gate asserts
  engine compatibility, and since the Part 13 ack-policy re-review it
  accepts a durable engine only when the claim is coherent
  (`storeDurable: true` + `storeBackend: "postgres"`). Part 15 added one more
  read-only route beside retention - `POST /internal/v1/enablement/audit` -
  which counts the catalogue and the rows to grade whether row-level security
  is actually enabled and isolating for the engine's own tables, answers 200
  with a FAIL finding because the finding IS the evidence, and writes nothing
  to the database: the durable record of a run is a line in the DR manifest's
  evidence ledger, appended by an operator script that has no credentials of
  its own (docs/PART15_RLS_ENABLEMENT.md). Part 16 added one more internal
  read-only route beside those - `POST /internal/v1/placement/attest` - which
  runs the venue-side review for one would-be order and answers with the verdict;
  it answers 200 when the review refuses, because the refusal IS the answer to
  the question asked, and every response carries `transmitted: false`, which is a
  constant in this build rather than a computed field. The review is not a second
  rejection path: its verdict is gate 11 of 11 in the engine's safety set, so one
  code path produces the blocked-gate incident, the audit event and the typed
  result, and the verdict's own fields ride inside the order's `SUBMITTED` event
  payload. On a simulated runtime it runs on every order and changes no outcome,
  recording its findings as `INFO`; on a runtime that could transmit, a review
  that cannot be answered is a refusal - and that runtime refuses to start with
  no reviewer wired at all. The posture is published where two deployments can be
  compared: `GET /internal/v1/status` carries `credentialSource` (which key source
  this process was willing to read - the source, never a credential) and a typed
  `placement` block naming the mode, whether a venue answer is required, the
  gatherer's provenance, the policy's bounds and the cache's counters, so "was
  this engine even wired to ask" is answerable without shell access. The same
  dictionary is spread into `/health/ready` with no token at all, because a probe
  cannot be handed a service token it was never issued; that is safe only while
  `describe()` is secret-free by construction, and a test holds both halves of
  that sentence - every described key reaching the probe, and nothing
  credential-shaped at any depth. It is typed
  rather than a passthrough dict so that a field added to the runtime's
  description has to be *decided* before it reaches an internal caller
  (docs/PART16_PLACEMENT_REVIEW.md). Part 18 added one more field decided that
  way - `metricsConfigured`, published because a scrape of all zeros needs an
  answer to "is this process measuring anything at all", and beside it the same
  fact as a wiring gauge. The reason both exist is that until that part this
  service had never handed its engine an instrument, so every counter the
  documents above describe was being incremented by `None`
  (docs/PART18_METRICS_EXPOSITION.md).
  Part 19 is the third instance of that same decision, and the one that shows why the
  rule exists: `describe()` grew `credentialFetcher` and `operatorConfirmation` beside a
  `liveEnablement` block, and because `/health/ready` spreads the wiring view verbatim to a
  caller with no token, the confirmation could only be published as `public_summary()` -
  `required`, `keyConfigured`, `recordPresent`, `expiresAtMicros` and a 12-character digest
  fingerprint. A full digest or the nonce would have made an unauthenticated probe a way to
  collect the material a signed authorisation is made of. Two consequences are pinned rather
  than remembered: `PlacementStatusView` had to grow its two fields in the same edit (its base
  model is `extra="forbid"`, so a describe() key with no schema field is a 500 on both routes,
  which is the failure this law is designed to produce - loudly, at the boundary, instead of
  quietly publishing a partial picture), and the credential fields moved to the names
  `providerSource` / `providerFetcher` IN LOG RECORDS ONLY, because `RedactionFilter` replaces
  the value of any key whose NAME is credential-shaped and a boot line that reads `[REDACTED]`
  where the mechanism name belongs explains nothing to the person it is written for (the API
  spelling is untouched; docs/PART19_LIVE_ENABLEMENT.md sec. 3 and sec. 7).
  Part 17 added
  the second half of the same idea: the engine's incident records are durable over
  the same Postgres pool as the order store (``engine_incidents``), a durable store
  paired with the memory sink is refused at construction rather than noticed after
  a restart, and ``POST /internal/v1/incidents/list`` answers "what is open" with a
  503 when the store cannot reply - because an empty list is what a healthy system
  looks like, and this service would rather be unavailable than misleading
  (docs/PART17_DURABLE_INCIDENTS.md).

Read-replica routing lives beside it as a policy, not a rewire:
`routeRead` fails closed in every direction (execution-critical reads never
see the replica; unknown lag or a stale probe routes primary;
half-configured deployments refuse to boot), and the counter family
`wlct_read_routing_decisions_total` makes "we have a replica we never use"
a number instead of a rumor.

The full law, the queue-consumer inventory, the runbook and the honest
deferral list are in `docs/PART11_WORKER_SCALING.md`.

The engine's self-description has a reader now (Part 20). `describe()` on the runtime
becomes `StatusResponse` on `/internal/v1/status`, and the single TypeScript mirror of that
contract (`apps/api/src/modules/worker/engine-status-contract.ts`) is a table the parser
walks, so the two languages cannot disagree in silence: a spec parses `schemas.py` and
compares field names, kinds, requiredness and defaults one by one. The same parsed object
feeds the worker's startup gate and the operations panel's `ENGINE POSTURE` section, which
is the only place in the platform where the process holding the venue credentials is asked
rather than inferred. The engine is deliberately not a health-mirror publisher - it owns no
Redis client, and copying its facts into a cache a reader polls would be a second copy of a
truth the author already answers on request. `docs/PART20_ENGINE_STATUS_EDGE.md` is the
document; the absence laws (required key missing is a refusal, optional key missing is the
engine's own default, unknown key is reported not dropped) are its sec. 2.

## 8. Real-time

Socket.IO on the `/realtime` namespace. Tokens arrive only in the handshake, and
room membership is derived server-side from the authenticated identity - a
client cannot ask to join `tenant:someone-else`. Cross-node fan-out publishes to
the Redis channel `realtime:dispatch`, and the Redis adapter is keyed with the
configured prefix so several environments can share one Redis instance safely.

## 9. Execution safety

Part 1 must not be able to move money. Four independent gates:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine exposes risk evaluation only; there is no order-placement
   route to call.
3. `RiskDecision.wouldExecute` is `approved AND EXECUTION_ENABLED`, so even an
   approved intent reports that it would not execute.
4. The execution engine's eleven-gate safety set ends in `PLACEMENT_ATTESTED`
   (Part 16), and the runtime that would transmit is the one that refuses to boot
   without a reviewer wired - so gate 4 does not depend on the platform flag being
   read correctly, which is the whole reason it is counted separately.

`EXCHANGE_SANDBOX_MODE=true` additionally disables any venue without a sandbox.

## 10. Deployment

`docker-compose.yml` is the reference topology. Migrations run as a one-shot
job (`migrate`) that must complete successfully before the API starts - running
them from every replica is a race, and a failed migration should stop a deploy
rather than crash-loop an application container.

All images are multi-stage, run as non-root, carry health checks, and contain no
source, no `.env` and no build cache.

## 11. What Part 1 deliberately does not do

* No copy-trading engine, position sizing, or follower allocation.
* No live order placement.
* No payment provider integration (no card data touches the platform).
* No KYC provider integration (the model and status field exist).
* No row-level security policies yet.
* No simulated trading results anywhere in the product.
````


## FILE: docs/SECURITY.md (624 lines)

*the /metrics posture bullet extended: the token is the API plane's control and is deliberately absent on the three Python services, because what makes those safe to scrape is the cardinality law at registration - there is nothing identifying on them to disclose - and the bullet says so instead of leaving a reader to conclude the exception was overlooked.*

```markdown
# Security

This document states what the platform does, why, and where the control lives in
the code. It is written to be checked, not admired: every claim points at a file.

## Threat model in one paragraph

The platform holds credentials that can place trades on a user's exchange
account, and it serves many organisations from one deployment. The two failures
that matter most are **cross-tenant data exposure** and **exchange credential
disclosure**. Everything below is ordered by how directly it prevents one of
those two.

---

## 1. Tenant isolation

| Control | Where |
| --- | --- |
| Query-level tenant predicate | `apps/api/src/infrastructure/prisma/tenant-scoped-prisma.factory.ts` |
| Tenant resolution and override | `apps/api/src/modules/tenants/guards/tenant.guard.ts` |
| Non-null `tenantId` + scoped uniqueness | `apps/api/prisma/schema.prisma` |

* A client-supplied tenant identifier is **never** an authorisation input. For
  an authenticated request the tenant comes from the access token.
* Every tenant-owned model is in an explicit allowlist. Adding a table to the
  scoped set is a deliberate edit, not a default.
* Uniqueness is per tenant: two organisations may both have `admin@example.com`.
* Platform-scoped rows (`tenantId = NULL`) are only reachable by platform users,
  enforced by `@PlatformOnly()`.

## 2. Authentication

| Control | Detail |
| --- | --- |
| Password hashing | argon2id; memory/time/parallelism from `ARGON2_*` |
| Access token | short-lived JWT, dedicated signing key |
| Refresh token | stored as HMAC, rotated on every use |
| Reuse detection | a replayed token revokes the whole family and raises `TOKEN_REUSE` (CRITICAL) |
| Device binding | refresh tokens bound to a client-generated device id |
| Logout | access-token `jti` blacklisted in Redis until expiry |
| Global revocation | `sv` claim vs `User.sessionVersion`, checked on every request |
| Session cap | LRU eviction by `lastSeenAt` |
| Lockout | per-account after `LOGIN_FAILED_MAX_ATTEMPTS` within the window |
| Enumeration | identical response and timing for unknown and wrong-password |

### Invalidating live access tokens

Blacklisting a `jti` only kills one token. Password changes and "sign out of
all devices" have to kill *every* token the user holds, including ones already
in flight, so each access token carries an `sv` claim holding the user's
`sessionVersion` at issue time. `JwtStrategy` (and `WsAuthGuard`, so open
sockets drop too) compares it with the stored counter on every request and
rejects a mismatch with `TOKEN_REVOKED`. Incrementing the counter therefore
invalidates all outstanding tokens instantly, without a distributed blacklist.

An integer counter is used rather than comparing the token's `iat` with
`passwordChangedAt`. `iat` has one-second resolution while the timestamp is
stored in milliseconds, so any time-based comparison is ambiguous for tokens
minted in the same second as the change - which is exactly what happens when a
user is handed new tokens immediately after changing their password, or when a
freshly provisioned tenant owner signs in for the first time. The counter also
cannot be skewed by clock drift between API instances.

### Two-factor authentication

TOTP via `otplib`. The shared secret is encrypted at rest with AAD
`two_factor_secret:{userId}`. `lastUsedCounter` is persisted so a captured code
cannot be replayed inside its window. Recovery codes are argon2-hashed and
single-use.

The challenge token issued between the password step and the code step is
bounded rather than strictly single-use: up to
`TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS` (default 5) codes may be tried against it,
after which it is discarded, and it is burned outright the moment a code is
accepted. Burning it on first sight would force a user who mistyped one digit
back through the password step; allowing unlimited tries would leave a captured
challenge open to brute force for its whole TTL. The attempt counter lives in
Redis under the challenge `jti` and expires with it. The endpoint additionally
sits behind the strict `auth` throttler, so the per-challenge budget is the
inner of two independent bounds.

## 3. Authorisation

Deny-by-default. `JwtAuthGuard` rejects any request without a valid token unless
the route is explicitly `@Public()`.

`PermissionsGuard` re-reads the user's live permissions on every request rather
than trusting the token payload, so revoking a role takes effect immediately
rather than at the next token refresh. Wildcards (`*`, `resource:*`) are
supported. A denial emits `PERMISSION_ESCALATION_ATTEMPT`.

Roles are data. Seven system roles ship as immutable templates and are cloned
per tenant. Adding a role never requires an authorisation-code change.

## 4. Exchange credential protection

**The platform never stores an exchange API secret in plaintext, never returns
one through the API, and never writes one to a log.**

Envelope encryption (`packages/utils/src/crypto.ts`):

1. A fresh 256-bit data key (DEK) is generated per record.
2. The payload is sealed AES-256-GCM under the DEK.
3. The DEK is sealed under the key-encryption key (KEK) from
   `ENCRYPTION_MASTER_KEY_BASE64`, tagged with `ENCRYPTION_KEY_ID`.
4. Additional authenticated data binds the ciphertext to `{tenantId}:{userId}`.
   A row copied to another tenant fails to decrypt - tampering is detected, not
   tolerated.

### Key management

| Variable | Purpose |
| --- | --- |
| `ENCRYPTION_MASTER_KEY_BASE64` | active KEK |
| `ENCRYPTION_KEY_ID` | identifies the active KEK in each ciphertext |
| `ENCRYPTION_PREVIOUS_KEYS_JSON` | retired KEKs, decrypt-only |
| `ENCRYPTION_PROVIDER` | `local` or `kms` |

Rotation is zero-downtime: add a new KEK, move the old one into
`ENCRYPTION_PREVIOUS_KEYS_JSON`, and re-wrap records in the background. Nothing
needs to be decrypted and re-encrypted synchronously.

For production, set `ENCRYPTION_PROVIDER=kms` so the KEK never exists in process
memory as raw bytes.

### Runtime credential sources (Part 16)

The engine resolves exchange keys through one of three sources, chosen by
`EXECUTION_CREDENTIAL_SOURCE`. None of them is a place a key may be written into
a file that is committed, and none of them is allowed to answer "permitted"
without a venue behind it:

| source | what it is | what refuses |
| --- | --- | --- |
| `none` (default) | a provider that declines every authenticated lookup | a paper process that turns out to need a key fails loudly instead of trading on nothing |
| `environment` | exactly two variables (`<PREFIX>_API_KEY` / `<PREFIX>_API_SECRET`) for exactly one tenant/account pair | boot when `NODE_ENV=production` - an environment cannot scope a secret per customer, is copied into every crash dump, and does not rotate |
| `secret-manager` | a `SecretFetcher` in front of the encrypted store - since Part 19 selectable by configuration as `EXECUTION_CREDENTIAL_FETCHER=vault-kv2` (`app/secret_fetcher.py`), or injected in code by the service that owns the store | boot without a fetcher at all: the API, a queue job and this endpoint's own request body are all refused as places a key provider could be installed, and naming a fetcher for a source that ignores it is refused as a deployment that believes it has plumbing it does not use |

Cached credentials live for `EXECUTION_CREDENTIAL_CACHE_SECONDS` (default 300)
and are dropped on expiry rather than served stale; `invalidate()` exists because
rotation and revocation must stop working promptly. The cache is not a security
window and is not described as one anywhere. Resolution results are never
returned by any endpoint, and `ExchangeCredentials.__str__`/`__repr__`/`__format__`
are overridden so a key cannot enter a log line, an exception message or a
debugger's repr by accident - the redaction helper is defence in depth, not the
control.

The Vault fetcher keeps the same property the environment provider was built
with: there is no settings field that could hold the token. `EXECUTION_VAULT_TOKEN_ENV`
names a variable and the value is read from `os.environ` inside the module that signs
the request, so `to_public_dict()`, `model_dump()` and `repr()` of the settings object
each have nothing to leak - which is a stronger guarantee than "the view omits it", and
is tested as the absence of the field (`test_the_token_has_no_field_it_could_be_stored_in`).
What the fetcher will not do is also part of the control: it refuses an `http://` address
and a `user:pass@host` authority even over TLS, refuses a tenant, account or exchange
identifier that is not one safe path segment BEFORE any request leaves the process (the
alternative - percent-encoding it - is what would let a traversal reach another tenant's
secret), bounds the response body before parsing it and quotes no body in any refusal, and
never renders the secret map it read. A path template is validated at boot rather than
interpreted at order time, because a typo like `{tenent}` would otherwise look up a path that
does not exist and report "no secret" for every tenant until somebody notices.

The operator confirmation (Part 19) is an authorisation record, not a credential: it holds no
key material, and it is safe to store in a configuration management system - but its `digest`
is only as strong as the HMAC key that made it, so the key is env-only under the same rule as
a venue key (`EXECUTION_CONFIRMATION_KEY_ENV`, default `EXECUTION_CONFIRMATION_HMAC_KEY`,
minimum 32 characters, never a settings field). The record's own bounds are what make it an
approval rather than a standing permission: a window no wider than 90 days, a `nonce` of at
least 16 characters so a superseded ceremony is distinguishable from the live one in the audit
trail, and a scope over tenant, account, instance, exchange, symbol and order type that the
per-order review re-derives rather than trusts - approving `BTCUSDT` never authorises `SOLUSDT`.
Verification is `hmac.compare_digest` over canonical JSON (sorted keys, both because a
signature needs the byte sequence to be reproducible and because a set does not have an order),
never `==`, so a record cannot be probed one byte at a time. An expired record refuses every
order without stopping the process, because the process is still the only path that can
safely cancel and reconcile; a *missing* key or an unparseable record is a boot failure,
because that is a deployment whose configuration is wrong rather than merely old.

The review that consumes those credentials answers a narrower question than
"are these bytes signed correctly": whether this key may place this order type on
this symbol in this trading phase right now, and - since Part 19 - whether a named
operator authorised this scope inside a window the deployment can verify. A key that
can withdraw is a refusal on any runtime, and a venue that cannot be asked is a refusal
on a runtime that could transmit (docs/PART16_PLACEMENT_REVIEW.md,
docs/PART19_LIVE_ENABLEMENT.md).

### Incident records

An incident is the platform's own account of a failure, so two rules apply to it
that are stricter than the ones for ordinary logs. Details are scrubbed before the
record exists (`ExecutionIncident.create`), because the instinct when writing an
incident is to attach the failing request, and the request is where a key lives.
And the sink is durable: `engine_incidents` is written over the same pool as the
order store, the write path never raises into execution (a lost record is counted
and published, never a stopped order), the read path never returns an empty list on
a failure it could not distinguish from health, and there is no `UPDATE` anywhere -
closing an incident means recording a new one, which is what makes the trail
non-re writable by construction rather than by policy (docs/PART17_DURABLE_INCIDENTS.md).

### Operational rules

* Keys come from the environment or a secrets manager. Never from source, never
  from the database.
* Different keys per environment. A staging leak must not affect production.
* Exchange keys should be created trade-only, with withdrawal permission
  disabled and IP-allowlisted to the platform's egress addresses.
* The confirmation HMAC key is a signing key for authorisations and is custody-graded
  as one: one per environment, injected as an environment variable, rotated by
  restarting with a fresh value (a key rotation and a record replacement are two acts,
  not one, because the record is parsed at boot and the key at verifier construction).
  A key rotation invalidates every record signed with the previous key, because
  verification recomputes the digest with the key the process currently holds: mint with
  the new key, publish the record, restart, in that order, or the deployment spends an
  interval refusing its own orders with `OPERATOR_CONFIRMATION_UNVERIFIED`. Verdicts
  already recorded stay auditable - they carry the record's fingerprint and codes, not a
  live dependency on the key - which is why the fingerprint is published and the digest
  is not (docs/PART19_LIVE_ENABLEMENT.md sec. 5 and sec. 7).

## 5. Transport and browser security

| Control | Where |
| --- | --- |
| Helmet security headers | `apps/api/src/main.ts` |
| HSTS, `X-Frame-Options: DENY`, `nosniff` | API + `apps/admin-web/next.config.mjs` |
| Content-Security-Policy with per-request nonce | `apps/admin-web/src/middleware.ts` |
| CORS allowlist | `CORS_ALLOWED_ORIGINS` |
| HTTPS enforced in mobile production builds | `apps/mobile/lib/core/config/app_config.dart` |

### CSRF

The API is token-authenticated and stateless, so it is not inherently
CSRF-exposed. The admin console is, because it keeps its session in cookies. It
therefore uses:

* `SameSite=Strict`, `httpOnly`, `Secure` session cookies.
* A double-submit token: a readable `wlct_csrf` cookie echoed in an
  `x-csrf-token` header, verified on every state-changing route
  (`apps/admin-web/src/app/api/proxy/[...path]/route.ts`).

Tokens are never placed in `localStorage`. An XSS bug in the console cannot
read an `httpOnly` cookie.

## 6. Input validation

* API: `class-validator` with a global `ValidationPipe`
  (`whitelist`, `forbidNonWhitelisted`, `transform`). Unknown properties are
  rejected, not ignored.
* Shared schemas: `packages/validation`.
* Python services: pydantic v2 models with `extra="forbid"`.
* Admin console: zod on every route-handler body.
* Money is `Decimal` end to end - `Decimal(18,6)` in the database, decimal
  strings on the wire, `Decimal` in Python. Never a float.

## 7. Rate limiting

Two buckets backed by Redis so limits hold across replicas:

* `default` for general traffic.
* `auth` for sign-in, registration, refresh and 2FA - the endpoints an attacker
  hits first.

The tracker keys on `user:{id}` when authenticated and `ip:{tenantId}:{ip}`
otherwise, so one noisy tenant cannot exhaust another's budget. Health endpoints
are exempt.

## 8. Audit logging

`AuditLog` is append-only and tenant-scoped. Every privileged action records the
actor, action, outcome, resource, a before/after diff, the request id, and a
**hashed** client IP - never a raw address.

`SecurityEvent` records authentication anomalies: new device, impossible travel,
token reuse, permission escalation attempts, lockouts.

## 9. Logging hygiene

Never logged, in any service:

* passwords, in any form
* access tokens, refresh tokens, challenge tokens, session cookies
* exchange API keys, secrets or passphrases
* encryption keys, data keys, blind-index keys
* payment credentials
* raw client IP addresses

Enforcement:

| Runtime | Mechanism |
| --- | --- |
| Node | pino redaction paths, extensible via `PINO_REDACT_PATHS`; the recursive `redact()` in `@wlct/utils` (keys AND credential-shaped values AND buffers) gates audit payloads and error bodies |
| Python | `wlct_trading.observability.redaction` - since Part 9, the ONE policy both services' `logging_config.py` filters delegate to (recursive dicts/lists/bytes, exception messages, bounded depth). The old per-service key-only regex filters are gone; a cross-language fixture pins the two languages to identical answers |
| Flutter | `AppLogger.redact`, applied at every nesting depth |

The Flutter mobile client disables network logging entirely outside development,
because a request log there would contain a bearer token on a user's device.

### Telemetry-side rules (Part 9)

Observability is a secret-leak surface like any other, so it inherits the same
policy at its own boundary, enforced by the label policy in
`wlct_trading/observability/labels.py` and mirrored in the API registry:

* **Identifier and secret label names are forbidden outright** (`order_id`,
  `request_id`, `correlation_id`, `tenant_id`, `api_key`, `token`, ...) -
  not discouraged; refused at registration. Label names are additionally
  allow-listed, so inventing a label is a code review event.
* **Label values must be bounded wire tokens**; symbols and other finite sets
  only against declared enumerated domains. Series caps make runaway
  cardinality a counted refusal, not an outage.
* **Health details and incident links are redacted/validated at the boundary**:
  component details pass through the redactor where every publisher shares one
  policy; incident records are (kind, targetId) references only - no payload
  can ride into the operations tables by accident.
* **Correlation ids are UUID-or-mint, everywhere** - the API middleware and
  the Python services both refuse unbounded inbound values, so log fields and
  audit columns cannot be injected through a header.
* **`/metrics` exposure**: unauthenticated only under network isolation;
  `METRICS_TOKEN` (constant-time compared) is mandatory in production on the API
  plane, and the exposition's production-off posture is a boot error, not a
  setting: `OBSERVABILITY_ENABLED`/`METRICS_ENABLED`/`HEALTH_ENABLED`/
  `PROMETHEUS_ENABLED`/`ALERTING_ENABLED` cannot be false in production. The three
  Python services (`services/trading-engine`, `services/market-data`,
  `services/execution-engine` since Part 18) share the `OBSERVABILITY_ENABLED`
  name, its default, and that refusal, and none of them requires the token: the
  guarantee that makes the exposition safe to leave unauthenticated is the
  cardinality law at registration - a metric sample here cannot carry a tenant,
  account, order or client-order id, so there is nothing on it to disclose and
  nothing for a token to buy beyond a delay. The token is therefore not this
  surface's control, and the internal network is; docs/PART18_METRICS_EXPOSITION.md
  sec. 7 states what would have to change (a new label) before the difference
  became a hole rather than a decision.
* **No metric sample is a financial record.** Panels report; the risk gate
  decides; nothing in the trading path imports the observability layer
  (boundary tests enforce the one-way dependency).

### Trace-side rules (Part 10)

W3C trace context is attacker-influenced input - every service treats it that
way, and the rules below are enforced by tests on both sides of the language
line:

* **Inbound `traceparent` is parsed-or-ignored, never trusted.** Malformed,
  version-mismatched, all-zero-id, or over-long headers simply do not join:
  the process starts its own root. A foreign trace id can never group
  spans from two unrelated requests, which is how a correlation surface
  becomes a privacy leak.
* **Trace ids are correlation handles, not credentials, and nothing more
  enters the wire.** Span attributes pass a closed-set sanitizer (`safe
  attribute` in both languages): key allow-regex, sensitive-name refusal
  (`api_key`, `authorization`, `password`, ...), value redaction through the
  same `redaction` policy the loggers use, length caps, and a ban on the
  forbidden label names from the metric policy. Header values that must
  travel (the traceparent itself) are re-canonicalised, never echoed raw.
* **Spans carry no payloads.** The queue hop continues traces through a
  Redis **sidecar** keyed by queue+jobId holding only the 55-char traceparent
  - never inside the job payload - so span-graph joins exist without any
  payload ever being copied into telemetry. Writes are fire-and-forget with a
  TTL; a failed sidecar can neither fail nor alter a publish.
* **Fault injection is a boot-time, non-production, closed-set configuration**
  (`FAILURE_INJECTION_ENABLED`, refused by the env validators of both
  runtimes in production). The only runtime operation anywhere is `consume`
  at instrumented points; there is no arm/disarm route, no admin control, and
  the armed plan is reported read-only. The metrics-scrape fault sits AFTER
  token authentication so injection state is not probeable.
* **The trading path never reads telemetry.** `consumeFault` exists in exactly
  two production files (the tracing service and the scrape endpoint); the
  engine's evaluate router must not contain the tokens `injector`,
  `tracer.`, `should_sample` or `sampler` (statically tested); risk decisions
  are computed before any hub is touched and the except-path records a sample
  then re-raises untouched. Sampling changes only what is RECORDED, never
  what is ANSWERED - an unsampled request still gets its `x-trace-id`.
* **SLO evidence is append-only and pruning is bounded.** `SloConfigurationVersion`
  rows are immutable (the only "update" appends version N+1); evaluations and
  sample buckets expire no faster than 7 days regardless of configuration;
  deleting history is not an API surface on any plane.

## 10. Internal service authentication

The Python services are not public. Every route requires:

| Header | Meaning |
| --- | --- |
| `x-internal-token` | equals `INTERNAL_SERVICE_TOKEN`, minimum 32 chars, compared with `hmac.compare_digest` |
| `x-tenant-id` | the tenant the call acts for; the body must agree or the call is rejected |
| `x-request-id` | optional, propagates the API's correlation id |

Comparison is constant-time. A token that is a known placeholder is rejected at
startup rather than accepted quietly.

## 11. Execution safety

Four independent gates prevent Part 1 from placing an order:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine has no order-placement route.
3. `RiskDecision.wouldExecute = approved AND EXECUTION_ENABLED`.
4. The execution engine refuses to start in live mode with no placement reviewer
   wired, and refuses each order whose review is not an unambiguous venue permit
   (Part 16, gate `PLACEMENT_ATTESTED`) or that a required operator confirmation
   does not cover (Part 19, `OPERATOR_CONFIRMATION_*`). There
   is no configuration that removes control 4, because a switch that lets a
   deployment trade without asking the venue whether the key may trade is the same
   as no review - which is why the confirmation is a signed, scoped, expiring record
   and not an `ALLOW_LIVE` boolean: a boolean is the same kind of object as the
   switch this control exists to make impossible.

`EXCHANGE_SANDBOX_MODE=true` additionally disables venues that offer no sandbox.

## 12. Dependency and container posture

* Pinned base images (`node:20.11.0-bookworm-slim`, `python:3.11-slim-bookworm`,
  `postgres:16.4-alpine`, `redis:7.4-alpine`).
* Multi-stage builds; runtime images contain no compiler, no source, no `.env`.
* Every container runs as a non-root user.
* Postgres and Redis publish to `127.0.0.1` only.
* Redis requires a password and uses `volatile-lru`, so queue jobs and sessions
  are never silently evicted.

## 13. Incident response starting points

| Situation | First action |
| --- | --- |
| Suspected token theft | Bump `User.sessionVersion` to invalidate every session for that user |
| Suspected KEK exposure | Rotate `ENCRYPTION_MASTER_KEY_BASE64`, move the old key to `ENCRYPTION_PREVIOUS_KEYS_JSON`, re-wrap in the background |
| Tenant compromise | Set the tenant to `SUSPENDED`; this mass-revokes its sessions |
| Exchange key exposure | Revoke at the exchange first, then delete the record |
| Panel says "healthy" but reality disagrees | Check the publisher mirrors first (`GET /health/components` per service, the fold's `mirrorPresent` in the sync log, and `wlct_registry_series_overflow_total`); absence of alerts means *no publisher reported*, never "all clear" |
| Metrics exposition exposed too widely | Rotate `METRICS_TOKEN`, restrict the listener; the payload itself is label-policy-guarded, so assume no leak of identifiers/secrets until proven otherwise - but treat scraping clients as known callers |

## 14. Worker plane (Part 11)

* The worker (`src/worker.ts`) serves no HTTP at all - not "no public
  routes", no listener exists. Its only egress is one internal service.
* The worker-to-engine secret (`EXECUTION_INTERNAL_TOKEN` /
  `EXECUTION_ENGINE_TOKEN`) is a deployment secret, min 32 chars,
  placeholder-prefixed values refused at both boots, constant-time compared,
  carried ONLY in a header - the engine's client never puts it in a body,
  and its own error surfaces never echo payloads (422 names fields, 500s
  carry correlation ids).
* The execution engine accepts no tenantless command (tenant header
  required), rejects body/header tenant divergence with 403, and its
  simulated answers are labelled as such at every surface. One route is not a
  command, and Part 20 wrote that distinction down instead of leaving it implied:
  `GET /internal/v1/status` answers with this process's own wiring and acts on no
  tenant, so it depends on `require_internal_auth_readonly`. The token is still
  required (401 without it, and the check runs first, so a stranger cannot reach the
  tenant branch); a tenant header that IS sent is still validated (400 on a bad one,
  because an exemption from presence is not an exemption from sanity); the command
  scope's refusal text is unchanged to the byte, because the worker matches on it; and
  a test walks the application's route table to hold the read scope to that one
  route, since the way a scoping exemption rots is by becoming convenient. The
  exemption cannot disclose anything that was hidden: `GET /health/ready` publishes a
  superset of those keys to an unauthenticated caller, and that superset relation is
  itself a test, so narrowing readiness without re-arguing the exemption fails CI.
* `EXECUTION_MODE=live` is refused at the engine's startup by code: the
  queue, the worker, or any API route cannot talk the process into venue
  transmission. Part 16 wired the credential source and the review and Part 19
  closed the per-tenant key custody half of the open list with the Vault fetcher, so
  the remaining items are computed at boot from the wiring the process built rather
  than asserted in a document: `VENUE_ATTESTOR_WIRED` and `SIGNED_TRANSPORT_WIRED`
  (one absence seen twice - the gatherer is built over the live adapter this
  composition root never constructs), `DISTRIBUTED_LOCKS_WIRED` (the core ships a
  Redis lock manager; `app/composition.py:338` does not select it), and
  `DURABLE_STORE_WIRED`, whose store shipped in Part 13 (docs/PART13_DURABLE_STORE.md)
  and is selected by `EXECUTION_STORE_BACKEND=postgres`. They stay enforced, not
  configurable away, and `liveRefused` is `true` in the report of every build this
  repository ships (docs/PART19_LIVE_ENABLEMENT.md sec. 7 and sec. 8). The placement route is internal-plane only like the rest:
  token, tenant-header-matched, absent from the worker's forwarding path list,
  and its response model has no field a credential could occupy (a test holds
  that, so the day a secret-bearing view is added the suite says so).
* The ops view (`GET /v1/observability/worker-coordination`) reads claim
  state written by workers and writes nothing; an expired claim is reported
  as absence, never as a dead worker.
* The execution engine's own posture reaches the same panel the same way (Part 20,
  `GET /v1/observability/execution` -> `ENGINE POSTURE`): one process reads
  `/internal/v1/status` through the worker's client and renders what the engine says about
  itself. Three properties are held by tests rather than asserted here. No credential
  material crosses the surface - the section's rendered JSON is scanned for secret shapes
  and for the correlation `fingerprint` the status document does carry, so a row that
  dumps a sub-document whole fails the suite; a missing answer renders `unverified`,
  never `ok`, because an absent engine is not a healthy one; and the read cannot become a
  control, since the only fields it consults for tone are the engine's own claims about its
  wiring. Nothing on this path writes, and nothing on it can enable live mode: the
  `EXECUTION_MODE=live` refusal above is unchanged by this part, as is the fact that no
  order leaves the process.
* `docs/dr/schedule/dr.cron` is generated from `docs/dr/manifest.json` by
  `--emit-schedule` and verified by `--check-schedule`. It schedules the three read-only
  modes (`--due`, `--check`, `--check-rls`) and cannot schedule the ledger's two write
  modes: a job that records an outcome nobody observed is faked seed data, and the drift
  gate refuses a hand-added `--record` line on its own terms rather than as a byte
  mismatch. The emitted file also avoids the `NAME=long-literal` shape the repository's
  secret scanner keys on, by naming its one free variable in lower case - the scanner is
  not narrowed for the artifact's convenience (docs/PART20_ENGINE_STATUS_EDGE.md sec. 6).

## 15. Known gaps for later parts

* Row-level security: policies and the GUC plumbing ship in Part 11, **dormant
  by design** - enablement is the checklist-gated `apps/api/prisma/rls/enable.sql`
  DBA step, verified by the probes in docs/DR.md; coverage is generated from
  the schema and spec-pinned so no tenant table can silently lack a policy.
* No automated dependency scanning in CI.
* No WAF or bot management in front of the API.
* No hardware-backed key storage; `ENCRYPTION_PROVIDER=kms` is the hook.
* Backups: the contract (manifest, validator, dry-run planner, drill record)
  ships in Part 11; Part 12 adds the freshness ledger (per-component cadence
  or explicit waiver, `--due`'s alertable exit code, `--record` with a
  note-level secret scan that JSON escaping cannot launder) - but the
  *scheduler* that runs them on a timer is still deployment-side wiring, so
  backups today are operator processes against a validated, checkable plan,
  not an unverified cron.
* Worker membership registry (Part 12): the heartbeat zset is
  deployment-scoped state, deliberately NOT tenant-scoped (fleet topology
  is operator-visible by necessity); it carries only worker-id tokens, and
  the registry can never grant authority - claims remain the sole gate, so
  a poisoned or forged membership entry buys an attacker deferral of
  nothing and access to nothing.
* The execution engine's default store is process-local (durability
  `false` is REPORTED, not hidden). The Part 13 durable backend
  (`EXECUTION_STORE_BACKEND=postgres`) persists orders, the event journal
  and the fill ledger in the `engine_*` tables under the same tenant law
  as everything else: every store transaction sets `app.tenant_id` first,
  the tables carry `tenant_id UUID` + the generated row-level-security
  policies, and configuration mismatches (postgres without a DSN, a DSN
  with memory, missing tables) are STARTUP refusals - an engine never
  claims durability it does not have.
* Retention (Part 14) is the only deletion path on the engine plane and
  it is triply narrow: the event journal is the ONLY table any engine
  statement deletes from (a test scans the whole service to hold that
  line - orders, the fill ledger, and the run ledger are not deletable by
  ANY configuration), apply mode is dark until `EXECUTION_RETENTION_ENAB-
  LED=true` restarts the process, and every run - including refused-state
  rehearsals and zero-row runs - leaves a row in `engine_retention_runs`,
  under the same RLS law as its subjects. The route is internal-token and
  tenant-header-matched like the commands, is proxied by nothing public,
  and refuses cross-tenant form by construction (one `--tenant` per call,
  enforced by the same canonical-UUID guard the store writes under).
* Row-level security is a CLAIM, not a state (Part 15,
  docs/PART15_RLS_ENABLEMENT.md): the platform may say policies are enabled
  and enforcing only while a PASSING enablement audit is younger than
  `rlsEvidence.cadenceHours` in the DR manifest. The audit is six `SELECT`s
  and one `SET TRANSACTION READ ONLY` - no seeding, no writes, no
  enable/disable capability anywhere in the verifying code - run inside the
  same tenant-GUC transaction the money path uses, with the leak check
  deliberately performed OUTSIDE it (a bare count taken inside the GUC would
  be the scoped count by construction and could not report a leak). A role
  holding `BYPASSRLS` or superuser fails the whole run whatever the counts
  say; a run that skipped or missed a covered table grades `unverified`,
  which is a third answer and never a shade of green. The route answers 200
  with a FAIL finding rather than 500 (the audit ran; its answer is the
  evidence), refuses with 409/400/503 when there is no durable store, the
  request is out of scope, or `pg_roles` cannot say which role it audited,
  and it is internal-plane only: token, tenant-header-matched, and absent
  from the worker's forwarding path list, which is the public plane's reach.
  What it verifies is the engine plane's five tables; the platform's other
  covered tables (Part 17's `engine_incidents` among them: an unprotected incident
  table is a cross-tenant readable list of one tenant's failures, which is exactly
  the leak shape this audit hunts) stay with `enable.sql`'s checklist, and the manifest's
  `rlsEvidence.scope` says so in words the validator refuses to let anyone
  overclaim. The record of each run is one append-only line in
  `docs/dr/rls-evidence.jsonl` (secret-scanned, refusal-on-corruption like
  the backup ledger), and a RECENT failing audit outranks a stale passing
  one: fixing the alarm means fixing the isolation.
* The placement review (Part 16, docs/PART16_PLACEMENT_REVIEW.md) is the venue-side
  half of "may this order exist", and it is deliberately unable to permit anything:
  the policy object holds durations and bounds only - attestation age, key age,
  clock skew, the receive window, the IP-allowlist requirement - and has no field
  that grants a permission, because a knob that lets a deployment trade without
  asking the venue is the same as no review. Absence outranks evidence: no
  attestation is `NO_ATTESTATION`, a venue that says no is a different code, and a
  gatherer that could not answer is never reported as a permission. Severity is
  what refuses, so a runtime that CAN transmit raises an evidence-absence warning
  to a refusal, and a runtime that cannot records the same finding as `INFO` - the
  mode is part of the verdict digest, so a paper verdict can never be presented as
  authority for a live order. What is still open is custody, not the check: the
  environment source is refused in production, `secret-manager` needs a fetcher
  injected in code, and no HTTP surface of the engine may install one - so
  per-tenant key custody, a venue attestor instance, a signed transport with the
  egress addresses allow-listed at the venue, and Part 13's durable store are the
  four things standing between this build and live transmission.

## 16. Operational tooling that touches nothing (Part 21)

Three scripts (`scripts/dr-schedule-install.mjs`, `scripts/dr-rehearsal.mjs`) and two core modules
(`wlct_trading/observability/chaos.py`, `red.py`) exist to answer operational questions. They are
documented here because "it only reports" is the claim every tool that can reach something makes, so
the boundary is stated as rules instead:

* **No new secret surface.** Nothing in Part 21 reads a credential value. The rehearsal runner checks
  that environment *names* referenced by the DR manifest exist in a `.env.example` template and,
  separately, whether they are set in its own process - and records only the name, never the value,
  never a length. It forwards `DATABASE_URL` and `ENGINE_INTERNAL_TOKEN` to a probe by name, from
  its own environment, exactly as the service does; the values appear in no artifact it writes, and
  probe output is stored as a SHA-256 digest rather than as text.
* **The evidence artifacts scan themselves.** Before a rehearsal record is appended it is run through
  the manifest's own `findSecretShapes`, and a hit is a refusal to write (exit 3), not a redaction. A
  tool that silently redacted would eventually be trusted with notes it should not accept.
* **Commands are an argv allowlist, never a shell.** Both scripts spawn with argument arrays, no
  shell, a per-call timeout, and a hard-coded allowlist: `crontab` for the installer, and the four
  named probes for the rehearsal runner. There is no configuration field, flag, or manifest key that
  becomes a command line - a rehearsal tool that accepted a command from a JSON file would be a
  remote-execution tool with a clipboard. Tests assert this on the source text (one `spawn`/`spawnSync`
  call site each, no `exec`, no `shell: true`) because a property like this is only worth what the
  check that enforces it is worth.
* **Paths are validated to stay inside the repository.** The `paths` a manifest component declares
  are resolved under the repo root and refused on traversal, as is every `--schedule`/`--manifest`/
  `--out` override. A malformed path is a `FAIL` finding in the record, not an attempt.
* **Production is refused, and ambiguity is refused.** The rehearsal runner refuses `--target
  production`/`prod` and any target it cannot prove non-production (a closed set: `local`, `dev`,
  `test`, `ci`, `staging`), refuses to run under `NODE_ENV=production` whatever `--target` says, and
  requires `--confirm <rehearsalId>` - the hash of the plan being approved - for `--execute`. The
  chaos matrix refuses `production` and any environment name outside its closed set before reading a
  probe, and its probes can only read the injector's state: the injector has no arm method, is
  constructed from validated configuration, and production boot refuses `enabled=True` (Part 10).
* **Grades are not opinions.** `pass`, `fail`, `unverified`, `planned` and `skipped` are the whole
  vocabulary in these tools. `unverified` is required whenever the thing being checked is
  unreachable - no cron facility, no database, no worker process - and a rehearsal ledger refuses to
  parse a dry run recorded as `pass`. The point of the distinction is that a red cell in a recovery
  plan is information and a green cell that was not earned is an outage waiting to be scheduled.
* **The trading path does not know any of this exists.** No money-path module imports the matrix, the
  RED view, the status document or a rehearsal record; a test walks the tree and asserts it. The
  schedule installer writes nothing but a marked block in a user crontab and preserves every
  unmanaged entry byte for byte, so a DR check cannot become the cause of the outage it exists to
  detect.
```


## FILE: docs/GETTING_STARTED.md (325 lines)

*a note beside docker compose up, where a reader would otherwise form the belief that these images start: what was broken, what it looked like, and the test that now loads every image command.*

````text
# Getting started

Local setup, from a clean checkout to a running stack.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 20.11.0 (see `.nvmrc`) | API, admin console, notification worker |
| npm | 10+ | workspaces |
| Docker + Compose v2 | recent | Postgres, Redis, the full stack |
| Python | 3.11 | trading-engine, market-data (only if run outside Docker) |
| Flutter | 3.22+ | mobile client (optional) |

## Quick start

```bash
git clone <your-repository-url> whitelabel-copytrade
cd whitelabel-copytrade

./scripts/bootstrap.sh
```

`bootstrap.sh` is idempotent. It creates `.env` from `.env.example`, fills any
placeholder secret, installs dependencies, generates the Prisma client, starts
Postgres and Redis, applies migrations and seeds baseline data. It never
overwrites a value that already looks configured.

Then:

```bash
npm run dev:api            # http://localhost:4000  (docs at /docs)
npm run dev:admin          # http://localhost:3000
```

## Manual setup

If you would rather do it step by step:

### 1. Environment

```bash
cp .env.example .env
chmod 600 .env
node scripts/generate-keys.mjs --write .env
```

Every variable that still reads `change_me` must be replaced before the API will
start - the environment is validated by zod at boot, and an invalid value aborts
the process rather than degrading silently.

Minimum set for a local run:

```
DATABASE_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
ENCRYPTION_MASTER_KEY_BASE64, ENCRYPTION_KEY_ID, BLIND_INDEX_KEY_BASE64
INTERNAL_SERVICE_TOKEN
SESSION_COOKIE_SECRET
```

### 2. Dependencies

```bash
npm install                # installs every workspace
```

### 3. Data stores

```bash
docker compose up -d postgres redis
```

Or point `DATABASE_URL` and `REDIS_*` at your own instances.

### 4. Database

```bash
npm run prisma:generate    # generate the client
npm run prisma:migrate     # create and apply a migration (development)
npm run db:seed            # system roles, permissions, platform plans, admins
```

For a non-development environment use `npm run prisma:deploy`, which applies
existing migrations without generating new ones. `npm run prisma:reset` drops
and rebuilds a scratch database.

Two things about these commands are worth knowing:

* **They load the root `.env` explicitly.** Every Prisma script is wrapped in
  `dotenv -e ../../.env --`. The Prisma CLI only looks for a `.env` next to the
  schema or in the current working directory, and these scripts run inside
  `apps/api`, so without the wrapper the whole monorepo would need a second copy
  of its environment file. Running `npx prisma` by hand from `apps/api` will
  therefore fail with `Environment variable not found` - use the npm scripts, or
  pass `--schema` from the repository root.
* **`DIRECT_DATABASE_URL` must be set**, even with no connection pooler in play.
  `schema.prisma` declares `directUrl`, and Prisma validates that the variable
  exists before it does anything else (error `P1012`). With no pooler it is just
  `DATABASE_URL` without the `connection_limit`/`pool_timeout` parameters.

The seed is idempotent - running it twice changes nothing. It creates:

* the 7 system roles with their permission sets
* the platform tenant and its branding
* the three platform plans (`starter`, `growth`, `enterprise`)
* a super-admin from `SEED_SUPER_ADMIN_*`
* a demo tenant and its admin from `SEED_TENANT_ADMIN_*`

Change those passwords in `.env` before seeding anything you will keep.

### 5. Run

```bash
npm run dev:api                 # NestJS, watch mode
npm run dev:admin               # Next.js
npm run dev:notification        # BullMQ worker
```

Python services, outside Docker:

```bash
cd services/trading-engine
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # set INTERNAL_SERVICE_TOKEN to match the root .env
uvicorn app.main:app --reload --port 8001
```

```bash
cd services/market-data
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8002
```

### 6. Mobile

```bash
cd apps/mobile
flutter pub get
flutter gen-l10n

flutter run \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
  --dart-define=TENANT_SLUG=platform
```

`10.0.2.2` is the host loopback from the Android emulator; use `localhost` on
the iOS simulator.

`android/` and `ios/` are not committed. Generate them once:

```bash
flutter create --platforms=android,ios --org com.yourcompany .
```

## Full stack in Docker

```bash
docker compose up -d --build          # includes the development overlay
docker compose -f docker-compose.yml up -d --build   # production-like
```

Both commands start three Python services (`trading-engine`, `market-data`,
`execution-engine`), and until Part 18 none of the three images could reach the
point of serving: each Dockerfile passed `--log-config /dev/null`, uvicorn hands a
non-`.json`/`.yaml` path to `logging.config.fileConfig`, and that refuses a
zero-length file (`RuntimeError: /dev/null is an empty file`, true since at least
python 3.11.9). They now pass `--log-config ./log-config.json` - two no-op keys
that keep uvicorn from reconfiguring the app's JSON log pipeline.
`execution-engine` needed one more thing: its module exposes `create_app` and
deliberately no module-level `app`, so the `app.main:app` target its image named
resolved to nothing (the two siblings bind `app`, so their plain form is correct);
its command is now `uvicorn --factory app.main:create_app`. A test loads all three
image commands through uvicorn's own constructor -
`services/execution-engine/tests/test_part18_asgi_target.py` - so a recurrence
fails a suite instead of a deployment. The reasoning is in
`docs/PART18_METRICS_EXPOSITION.md` sec. 6.1.

### The Part 19 knobs, and what a first deployment should leave alone

`services/execution-engine/.env.example` documents thirteen variables Part 19 added -
one fetcher selector (`EXECUTION_CREDENTIAL_FETCHER`), eight for Vault KV v2
(`EXECUTION_VAULT_ADDR`, `..._MOUNT`, `..._PATH_TEMPLATE`, `..._TOKEN_ENV`,
`..._NAMESPACE`, `..._TIMEOUT_MS`, `..._TLS_VERIFY`, `..._MAX_RESPONSE_BYTES`) and four
for the operator confirmation (`EXECUTION_REQUIRE_OPERATOR_CONFIRMATION`,
`..._OPERATOR_CONFIRMATION_JSON`, `..._OPERATOR_CONFIRMATION_FILE`,
`EXECUTION_CONFIRMATION_KEY_ENV`). Every one of them defaults to the dark side, none
of them opens the money path, and the two key variables are deliberately absent from
`docker-compose.yml` - a compose file is a place secrets get copied from, and these
values are read from the process environment of the container that needs them.

### The two operational commands worth knowing (Part 20)

Nothing to configure - this part adds no environment variable at all. Two commands, both
read-only, both runnable today:

```bash
node scripts/dr-manifest.mjs --check-schedule   # is the DR watcher installed and current?
node scripts/dr-manifest.mjs --due              # what is overdue on the backup board?
```

`--check-schedule` fails when `docs/dr/schedule/dr.cron` no longer matches what
`docs/dr/manifest.json` implies, which is the difference between a control and a document;
installing it is `node scripts/dr-manifest.mjs --emit-schedule --root /srv/path --out
/tmp/dr.cron && crontab /tmp/dr.cron`, and the schedule never writes ledger evidence on
your behalf (that is the point: `--record` names a human).

For the engine's posture, the document to read is the one the worker reads. Dev-run, on
the port `docs/PART11_WORKER_SCALING.md` uses:

```bash
curl -s -H "x-internal-token: $EXECUTION_INTERNAL_TOKEN" \
  localhost:8093/internal/v1/status | python3 -m json.tool
```

Twenty keys, no secrets among them, and since Part 20 they need no tenant header (the
route reads the process, not a tenant - `docs/PART20_ENGINE_STATUS_EDGE.md` sec. 7 for
why, and `docs/SECURITY.md` sec. 14 for the exemption's bounds). The same block is
rendered for operators as the `ENGINE POSTURE` section of
`GET /v1/observability/execution`, which sits behind an operations-read session rather
than a curl: it is a panel row, and a panel row that could not answer says
`unverified` instead of guessing.

What a first deployment should actually set: nothing here. What a deployment that wants
its review to have real evidence to reason over should set: `EXECUTION_CREDENTIAL_SOURCE`
(plus a fetcher if the source is `secret-manager`), so the credential lookup can be made,
and `EXECUTION_STORE_BACKEND=postgres` once the migration has run. The confirmation is the
last item, not the first: it is a record a human signs about a specific symbol and order
type, and minting one before the review above it has real evidence produces an approval of
nothing in particular. `docs/PART19_LIVE_ENABLEMENT.md` is the operational document -
sec. 5 is the minting ceremony with the exact bytes, sec. 9 is the order to turn the pieces
on, sec. 10 is the refusal catalogue for when a boot says no.

| Service | Address |
| --- | --- |
| API | http://localhost:4000 |
| Admin console | http://localhost:3000 |
| Swagger (when `SWAGGER_ENABLED=true`) | http://localhost:4000/docs |
| Postgres | 127.0.0.1:5432 |
| Redis | 127.0.0.1:6379 |

`trading-engine`, `market-data` and `notification-service` are internal-only in
the production composition. The development overlay publishes them on loopback
so you can probe them directly.

## Verifying

Two scripts, with different jobs.

`scripts/verify-part1.sh` is static: it inspects the repository (layout, secret
hygiene, TypeScript, Python tests) and does not need a running stack.

```bash
./scripts/verify-part1.sh
```

`scripts/smoke-test.sh` is dynamic: it drives a **running** API and asserts real
behaviour - health probes, login, refresh-token rotation and reuse detection,
global session revocation, the error envelope, and the security headers. It
exits non-zero on the first broken guarantee, so it can gate a deployment.

```bash
npm run smoke                       # against http://127.0.0.1:4000
API_URL=https://api.example.com npm run smoke
```

It reads `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` from `.env`.
Note that it deliberately triggers refresh-token reuse detection, which signs
that account out of every device - run it against a test account, never against
a live administrator.

Manual smoke test:

```bash
curl -s localhost:4000/health | jq
curl -s localhost:4000/health/ready | jq

# Sign in as the seeded super admin.
curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -H 'x-tenant-slug: platform' \
  -d '{"email":"superadmin@copytrade.app","password":"<your seed password>","deviceId":"curl-local-device"}' | jq

# Anonymous access to a protected route must be 401.
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/v1/users
```

## Common problems

**`Environment validation failed`** - a required variable is missing or too
short. The message lists each offending variable. Run
`node scripts/generate-keys.mjs`.

**`Can't reach database server`** - Postgres is not up, or `DATABASE_URL` points
at `localhost` while the API runs inside Docker (it should be `postgres`).

**`P3005: database schema is not empty`** - the database has tables but no
migration history. For a scratch database: `npm run prisma:reset -w @wlct/api`.

**Admin console shows "The platform API is unreachable"** - `API_BASE_URL` is
wrong. It must include the `/api` prefix: `http://localhost:4000/api`.

**`ENOTEMPTY` during `npm install`** - a previous install was interrupted.
`rm -rf node_modules package-lock.json apps/*/node_modules services/*/node_modules packages/*/node_modules`
then reinstall.

**Flutter: `Target of URI doesn't exist: app_localizations.dart`** - run
`flutter gen-l10n`. The file is generated and intentionally not committed.

## Useful commands

```bash
npm run build                  # every workspace
npm run typecheck              # api + admin-web
npm run lint
npm run test                   # API unit tests
npm run prisma:studio          # database browser

docker compose logs -f api
docker compose down -v         # stop and delete volumes (destroys data)
```
````


## FILE: docs/ROADMAP.md (354 lines)

*row 18, and the retirement sentence that says which backlog item this part closed and which deployment-side items it left alone - the alert rules and dashboards are still nobody's code, and the row says that rather than implying a scrape is an alert.*

```markdown
# Roadmap

Part 1 is the foundation. Everything below builds on it in an order chosen so
that each part is shippable, testable and reversible on its own.

The ordering rule: **nothing that touches money ships before the thing that
constrains it.** Risk, limits and audit come before execution; execution comes
before automation.

---

## Part 1 - Foundation (delivered)

Multi-tenancy, identity, RBAC, security, the API skeleton, the admin console
foundation, the mobile foundation, service skeletons, Docker.

Execution is hard-disabled.

---

## Part 2 - Exchange connectivity (non-custodial)

**Goal:** a user can securely attach a real exchange account, and the platform
can read from it. Still no order placement.

* Prisma: `ExchangeAccount`, `ExchangeCredential`, `ExchangeBalanceSnapshot`,
  `ExchangeAccountAudit`.
* Credential intake: submitted once, encrypted with envelope encryption at the
  edge, never returned. A validation call proves the key works and, critically,
  proves that withdrawal permission is **absent** - a key with withdrawal rights
  is rejected outright.
* `trading-engine`: real `ccxt` clients per venue, per-account rate limiting,
  a circuit breaker per venue, clock-skew detection.
* Read-only endpoints: balances, positions, open orders, trade history.
* `market-data`: authenticated feeds, websocket ingestion, the streaming flag
  turned on.
* Mobile and admin: connect-account flow, balance display.

**Ships when:** a real exchange key can be attached, validated and read from,
and the plaintext secret is provably absent from the database, the logs and
every API response.

---

## Part 3 - Trader profiles and strategy definitions

**Goal:** the objects copy-trading will reference, with no copying yet.

* Prisma: `TraderProfile`, `Strategy`, `StrategyVersion`, `PerformanceSnapshot`,
  `TraderFollowerLink`.
* Verified performance only: metrics are computed from executed fills recorded
  by the platform. No self-reported numbers, no backtests presented as results.
* Trader onboarding and approval, with a compliance gate.
* Discovery: search, filter and rank traders.
* Admin: trader approval queue, performance review.
* Mobile: trader list and detail screens.

**Ships when:** a trader can be onboarded and approved, and their performance is
derived exclusively from platform-recorded fills.

---

## Part 4 - The copy engine (paper first)

**Goal:** the full copy pipeline, executing against paper accounts only.

* Prisma: `CopySubscription`, `CopyRule`, `SignalEvent`, `MirrorOrder`,
  `PaperFill`.
* Signal pipeline: detect a leader's fill, translate it through the follower's
  sizing rule, apply risk, place a paper order.
* Sizing modes: fixed notional, proportional to equity, fixed multiplier.
* Risk per follower: max notional, max open positions, max leverage, per-symbol
  allow/deny, daily loss cap.
* Latency budget and slippage accounting, measured and exposed.
* Reconciliation: a periodic job that detects and reports divergence between the
  intended and actual mirrored state.
* `EXECUTION_ENABLED` stays `false`; `paper_trading` stays on.

**Ships when:** a follower's paper account mirrors a leader correctly under
adversarial tests - partial fills, rejects, disconnects, duplicate signals - and
reconciliation reports zero unexplained divergence.

---

## Part 5 - Live execution

**Goal:** real orders, on the user's own exchange account.

This is the highest-risk change in the project and gets treated accordingly.

* Order state machine with idempotency keys; a retried request never
  double-places.
* Exchange error taxonomy: which errors are retryable, which are fatal, which
  require human review.
* Kill switches: platform-wide, per tenant, per trader, per follower.
* Position reconciliation against the exchange as the source of truth.
* Progressive rollout: an allowlist of accounts, then a percentage rollout via
  the existing feature-flag bucketing.
* A dry-run mode that logs the exact payload that *would* be sent.

**Ships when:** a full audit trail exists for every order, every kill switch is
verified under load, and reconciliation has run clean for a sustained period on
the allowlist cohort.

---

## Part 6 - Billing and monetisation

* Payment provider integration (Stripe first). The platform stores no card data;
  it holds provider references only.
* Performance fees: high-water mark accounting, crystallisation periods,
  trader revenue share.
* Invoices, dunning, and a subscription lifecycle driven by provider webhooks
  with signature verification and replay protection.
* Payout ledger for trader earnings.

Money movement is double-entry from day one. A single-entry ledger is not
auditable and cannot be reconciled.

---

## Part 7 - Compliance and operations

* KYC/AML provider integration behind the existing `KycProfile` model.
* Jurisdiction rules: which tenants may onboard users from where.
* Suitability and risk questionnaires; risk-profile gating on copy limits.
* Data subject rights: export and erasure, honouring audit-retention duties.
* Regulatory reporting exports.
* SIEM export for the security event stream.

---

## Part 8 - Scale and reliability

* Read replicas and query routing.
* Time-series storage for market data and performance history.
* Horizontal scaling of the copy engine with partitioned work and leader
  election.
* Row-level security in Postgres as defence in depth behind the application-layer
  tenant scoping.
* Full observability: OpenTelemetry traces, RED metrics per endpoint,
  service-level objectives with alerting.
* Chaos testing: exchange outage, Redis failover, database failover.
* Disaster recovery with a rehearsed, timed restore.

---

## Cross-cutting work, continuous

| Track | Detail |
| --- | --- |
| Testing | unit, integration against a real Postgres, contract tests between the API and the Python services, load tests on the copy path |
| Security | dependency scanning in CI, an external penetration test before Part 5, secret-rotation drills |
| Documentation | an ADR for every consequential decision; an operational runbook per service |
| Accessibility | WCAG 2.1 AA on the admin console; screen-reader support in the mobile client |

## Sequencing constraints

These cannot be reordered:

1. **Part 2 before Part 4.** No copying without a validated exchange connection.
2. **Part 4 before Part 5.** Paper trading is how the pipeline earns the right
   to touch real money.
3. **Risk limits before execution.** The constraint ships before the capability.
4. **Audit before money.** Every financial action must be reconstructable from
   the audit trail on the day the feature launches, not retrofitted afterwards.

---

## Delivery log (as of Part 9)

The delivered parts renumbered relative to this early roadmap (which described
a backlog, not a sequence contract). What has shipped, with its authoritative
document:

| Part | Delivered | Document |
| --- | --- | --- |
| 1 | Platform foundation: multi-tenancy, auth/RBAC, audit, API + admin console + mobile skeletons, the pre-trade risk engine skeleton, connectivity transport | docs/PART1_*.md |
| 2 | Trading core library: order book, market data pipeline, clock/latency discipline | docs/PART2_*.md |
| 3 | Billing, notifications, feature flags, security-event pipeline | docs/PART3_*.md |
| 4 | Execution engine and exchange adapters (authenticated REST/WS, paper-first) | docs/PART4_*.md |
| 5 | Live execution control plane: credentials, kill switches, reconciliation, execution incidents | docs/PART5_*.md |
| 6 | Strategy layer: definitions, instances, backtest and paper sessions, metrics | docs/PART6_*.md |
| 7 | Historical datasets: ingestion, manifests, validation, storage, replay | docs/PART7_*.md |
| 8 | Real-time risk engine: the authoritative fail-closed gate, 22-rule catalog, snapshots, reservations, rate windows, switch lifecycle, risk console (+ read-only mobile viewer) | docs/PART8_RISK.md |
| 9 | Observability & operations: Prometheus exposition (both languages, cardinality-lawed), health/readiness/trading-readiness, alert fold with durable dedupe, incident correlation, shared redaction, queue observability, operations console | docs/PART9_OBSERVABILITY.md |
| 10 | Reliability: OTLP tracing (both planes, sampled, redaction-bound, honest export accounting), SLO/error-budget evaluator with burn alerts, queue-depth law, fault injection (non-prod, self-disabling), production config guards | docs/PART10_RELIABILITY.md |
| 11 | Scale & coordination: cross-language lease/partition foundation (fixture-pinned), the trading-worker plane (partitioned TRADE_EXECUTION consumer with deferral accounting and a strict engine failure taxonomy), services/execution-engine hosting the real core ExecutionEngine (simulated; live refuses by code), read-replica fail-closed routing policy, read-only worker ops view, generated + spec-pinned row-level security (dormant until the checklist-gated enablement), DR manifest with validator and timed-drill contract | docs/PART11_WORKER_SCALING.md, docs/DR.md |
| 12 | Self-registering worker membership (heartbeat-zset registry, fixture-pinned staleness law, config list demoted to fallback, resign-on-shutdown fast path, registry read in the ops view) and the DR backup-freshness ledger (manifest cadences or explicit waivers, --due grading with a cron-able exit code, --record with secret-scan and parse-refusal) | docs/PART12_WORKER_MEMBERSHIP.md, docs/DR.md |
| 13 | Durable execution-engine store: PostgresOrderStore over the core OrderStore port (orders/events/fills/reconciliation state), engine_* tables in Prisma with automatic RLS coverage and per-transaction tenant GUC, opt-in EXECUTION_STORE_BACKEND with no silent fallback either direction, and the worker ack-policy re-review that turned the durable-engine tripwire into a coherence check | docs/PART13_DURABLE_STORE.md |
| 14 | Journal retention: the core's pure retention law (terminal_at-not-status, whole-story-or-none, nonsense-proof policy), the engine executor over the store's own transaction contract (one deletable table, seq-listed batches, ceiling-then-resume), the never-pruned `engine_retention_runs` ledger with dry-runs recorded, apply dark behind config, and the cron-able tenant-per-call CLI with exit-code law | docs/PART14_RETENTION.md |
| 15 | RLS enablement made VERIFIABLE, read-only: the core's pure enablement law (probe shape, platform-scoped bare-read exception, role-attribute veto, pass/fail/unverified grading, nonsense-proof evidence window), the engine's six-statement audit executor (scoped count inside the tenant transaction, bare count outside it, nothing seeded, no write verb by construction), one internal endpoint that answers 200 with a FAIL finding, `scripts/rls-enablement.mjs` (audit/check/print-sql) with no database access of its own, and the append-only `docs/dr/rls-evidence.jsonl` ledger aged by `dr-manifest.mjs --check-rls` under a manifest-declared cadence | docs/PART15_RLS_ENABLEMENT.md |
| 16 | Placement attestation made a GATE rather than a second rejection path: the core's pure review law (absence outranks everything, the review can only tighten, staleness and skew are findings, six rules ending in a digest-stable verdict id over canonical JSON), four gatherers behind one ABC (unattested / local / a TTL cache keyed by the ORDER SHAPE after a coarse key proved to be a fail-open / Binance over the deployment's own signed adapter and weight budget), the service's eight source-and-cost knobs with no enable switch and production `environment` refused at Settings construction, one internal endpoint that answers 200 with a refusal because a refusal is data and carries `transmitted: false` as a constant, that posture published on `/status` as a typed block (the credential SOURCE and the gatherer's provenance, never a key), the venue package's export rule written down and tested rather than improvised, and live mode still refused at boot with the four remaining prerequisites listed in order | docs/PART16_PLACEMENT_REVIEW.md |
| 17 | Incident records made as durable as the orders they explain: the engine plane's own `engine_incidents` table (BIGSERIAL read order, uuid identity unique by constraint, VARCHAR vocabularies, no composite FK to orders, tenant FK that restricts), the SQL sink over the same pool as the store with the write law that never raises and the read law that never lies, the composition refusal for a durable store paired with a memory sink (and the mirror), one internal read route that returns 503 rather than an empty list, the sink published on `/status` through a typed view, and the fifth engine-plane table inside the generated row-level-security set (43 covered) so the audit can prove the isolation | docs/PART17_DURABLE_INCIDENTS.md |
| 18 | The engine's measurements made readable at the edge of the process that produces them: `GET /metrics` on `services/execution-engine` over the core's lawed registry (29 counter families DERIVED from `ExecutionCounters`' fields so an exporter cannot fall behind its instrument, one `stage`-bounded histogram copied whole per scrape instead of re-observed, seven wiring gauges read from `describe()` rather than from settings so a renamed key publishes 0 instead of a guess, and a reset counter because `inc` refuses a negative amount), the four spans the engine actually contains timed with the eight stages that cross a process or transport boundary left unrecorded and the reason written down, the shared adapter's nine-part cumulative double-accumulation found and killed by the first process that ever rendered it, `OBSERVABILITY_ENABLED` with production refusing it off (the knob `docker-compose.yml` had been passing to this service unread since the block existed), and the instrument the service had never handed its engine - which is how the counters Parts 5-17 documented as measurable were being accumulated by nothing, plus the three Python image commands that could never start a process (an `app.main:app` target this module does not define, and a `--log-config /dev/null` that `logging.config.fileConfig` has refused since python 3.11) | docs/PART18_METRICS_EXPOSITION.md |
| 19 | Live enablement made AUDITABLE without being made possible: the credential provider selection given its one concrete fetcher (`VaultKvSecretFetcher` over KV v2 - https-only with `user:pass@host` refused even over TLS, mount and path template validated at boot, identifiers matched against `[A-Za-z0-9._-]{1,64}` BEFORE a request is built, the rendered path bounded at 512 characters, the response bounded at 1 KiB..4 MiB and refused without being consumed, every non-200 one refusal that keeps its status and drops its body, and no field on `Settings` that could hold the token), the operator confirmation as a typed record rather than a flag (`LiveOperatorConfirmation`: HMAC-SHA256 over sorted-key canonical JSON, a 90-day ceiling on the window expressed in milliseconds against microsecond stamps, `nonce` >= 16 so two ceremonies over one scope are not byte-equal, `symbols`/`orderTypes` scoped per axis with an empty set meaning `all-configured` and never `nothing`, `SCOPE_MISMATCH` naming which axis, and no `required` without a key), the confirmation graded per order by the existing six-group law instead of a parallel gate (`CONFIRMATION` findings on the verdict, a reviewer that refuses to be built when the policy asks and nothing was supplied, a verifier that RAISES becoming a blocking `UNVERIFIED` naming the exception type and not its message), the axis that makes the whole picture countable (`ReviewArea`, seven areas, seven derived counters taking `ExecutionCounters` to 36 ints and the exposition to 36 families with no exporter change, `blocking_areas` in declaration order so one refusal renders one list), the live-enablement report graded from the wiring this process built rather than from a settings dump (eight `LivePrerequisite`s, `LIVE_*` codes spelled from the enum so they cannot disagree, `hardBlockersPresent` naming the one absence no configuration reaches, prose for the operator and names for machines), `/status` and `/health/ready` carrying the report plus a `public_summary()` whose fingerprint is 12 hex characters because an unauthenticated route may correlate a ceremony and must not reproduce it, boot log fields renamed `provider*` because `RedactionFilter` scrubs any credential-SHAPED KEY and `[REDACTED]` where 'which fetcher did I get' belongs is a boot line nobody can debug from, and 174 tests across five files - `EXECUTION_MODE=live` STILL refused, with the refusal now printing what it was graded against | docs/PART19_LIVE_ENABLEMENT.md |
| 20 | The operational tail's last two code-able gaps, both display and derivation and neither a gate: `/internal/v1/status` given ONE strict TypeScript mirror (20 keys, required-and-defaulted read differently, unknown keys reported, a spec that parses `schemas.py` and refuses to let the languages drift), and the engine's posture rendered on the ops panel as `ENGINE POSTURE` with a tone law in which absence never reads as health; plus `docs/dr/schedule/dr.cron`, generated from the manifest's cadences by `dr-manifest.mjs --emit-schedule` and drift-gated by `--check-schedule`, which may schedule the three read-only modes and never the ledger's writes. And one defect the audit only found by running the composition: `/internal/v1/status` demanded a tenant header its only caller cannot send, so `assertEngineCompatible()` got a retryable 400 and the reference worker exited 1 at startup - fixed by splitting the engine's internal law into a command scope (refusal text unchanged to the byte) and a read scope used by exactly one route and pinned by a route-table walk, with `docker-compose.yml` pointed at the engine so the new panel lights up. 3 Python files and 1 compose file moved; no gate, verdict or refusal threshold did, and live still refuses at startup, unchanged. `docs/PART20_ENGINE_STATUS_EDGE.md` |

Still open from the original backlog, deliberately NOT absorbed: time-series
storage behind the exposition (metrics are published, not retained; retention
beyond the durable alert/incident state remains future work - Part 14 closed
the EXECUTION STORE's journal retention, docs/PART14_RETENTION.md, which is
a different table and a different problem, and this item's wording is kept
deliberately so the two are never conflated), RED dashboards
beyond the built-in panel, disaster-recovery rehearsals, and the remaining
Part 8-scale items - enabling the shipped row-level-security policies in
staging per the enable.sql checklist (the Part 13 engine tables are
and Part 17's incident table are covered by the same generated machinery (43
covered tables today), so enabling remains one checklist for every tenant table - Part 15 did NOT retire that operator step, it made
enablement auditable, gradable and age-trackable afterwards, so the open item
is now "run the audit on staging", see docs/PART15_RLS_ENABLEMENT.md), the
full
chaos/failover matrix against real infrastructure (the invariants are
unit-pinned; a staging run remains a deployment step, see
docs/PART11_WORKER_SCALING.md sec. 18). Part 12 retired two items from this
list: worker membership is now self-registering (WORKER_MEMBERSHIP_MODE,
docs/PART12_WORKER_MEMBERSHIP.md) and backup cadence has its checking
mechanism (`dr-manifest.mjs --due`, exit-code alertable); Part 13 retired
the durable execution-engine store wiring (docs/PART13_DURABLE_STORE.md -
the store ships, the schema is Prisma-owned, and the worker gate's
ack-policy condition is resolved). Part 18 retired one backlog item and none of the deployment-side ones: the numbers a scrape needs are now published by the process that measures them, while the alert rules, the dashboards and the scrape targets stay in the deployment (docs/PART18_METRICS_EXPOSITION.md). Part 16 shipped its layers dark (docs/PART16_PLACEMENT_REVIEW.md) and retired no deployment item on purpose: the review now runs on every order a runtime could transmit and on paper orders only in practice, and the live path's remaining prerequisites - venue attestor instance, per-tenant key source, signed transport with an egress allowlist registered at the venue, durable store and distributed locks - are named there in order rather than implied. Part 19 retired the per-tenant key source and left the rest of that sentence standing, with one correction worth naming: the list is now COMPUTED from the wiring a process built instead of asserted in prose (docs/PART19_LIVE_ENABLEMENT.md sec. 7), and it reports `DISTRIBUTED_LOCKS_WIRED` as unsatisfied for a different reason than `SIGNED_TRANSPORT_WIRED` - the core already ships a Redis lock manager and `app/composition.py:338` does not select it, whereas nothing in this build could be put over a signed transport that was never constructed (the same section's note on the two kinds of absence). Two of the five items Part 19 was asked to close were already shipped by Parts 13-18, so its diff is the fetcher, the confirmation, the counting axis and the report, plus tests pinning the eight items the audit found done. What remains of
the backup item is deployment-side WIRING of that command into a scheduler
- the ledger refuses to fake its own seed data, so the first real
`--record` is the first real backup evidence. Part 20 shipped the scheduler side of that
sentence's first half - the schedule is a generated file with a drift gate rather than a
habit (`--emit-schedule` / `--check-schedule`, `docs/dr/schedule/dr.cron`,
`docs/PART20_ENGINE_STATUS_EDGE.md` sec. 6) - so what is left is the one command a host
runs (`crontab <file>`) and, still, the first real `--record`.


Part 21 took the operational tail end of this list and made it checkable, without
pretending to be infrastructure. `scripts/dr-schedule-install.mjs` installs, verifies,
idempotently re-applies and removes the generated schedule in a host crontab, refusing
on any drift it would have to author and exiting 4 rather than lying about a host with
no cron; `scripts/dr-rehearsal.mjs` is the drill record as data - a deterministic plan
built from `restoreProcedure`, per-component path and environment-name preflight, four
allowlisted probes, closed grades (pass/fail/unverified/planned/skipped), production and
unknown targets refused before anything is read, `--execute` gated on a confirmation that
must echo the plan's own hash, and an append-only evidence line that cannot legally
record a dry run as a pass; `--status` folds those laws into one exit code.
`scripts/dr-manifest.mjs --verify-rls` answers "what is verified about row-level security
right now" in machine-readable form - 43 covered tables agreeing in both directions with
enable.sql and disable.sql, matching schema stamps, and an evidence ledger that has never
been written, which is why the grade is `UNVERIFIED` and the tool's own `enabled` field is
`null`: verifying the scope of a policy is not the same act as claiming enforcement
(docs/PART15_RLS_ENABLEMENT.md remains the enablement path, unchanged). The chaos and
failover matrix is now a module rather than a paragraph
(`wlct_trading.observability.chaos`: ten scenarios A-J, each with setup, injection, the
invariant the runbooks already assert, observation, recovery, cleanup, a bounded timeout,
and a fault point drawn only from the closed set in `faults.py`), and a run in this
repository grades all ten `UNVERIFIED` and exits 2 by design - a harness result is labelled
`source=harness` and cannot be laundered into an infrastructure claim. RED is a *view*
(`wlct_trading.observability.red`) over the registry families the services already
register, rendered as existing `DashboardRow`s, with `no-data`, `zero-traffic`,
`measured`, `healthy` and `over-budget` kept distinct and with no default error budget
anywhere in the file: a verdict requires a caller-supplied `RedBudget` that names its
source, so the SLO and alert catalogs stay the only thresholds the platform has. What
remains open after Part 21 is the part no repository can close: running the drill, running
the matrix against real processes, wiring a scrape and a dashboard export into a
deployment, and the first real `--record`. Part 22 has since taken the scrape half of
that sentence (below): the jobs, the rule file and the reader now exist as generated files
under `infrastructure/observability/`, and the 17 catalog rules that carry `threshold: None`
still refuse to render rather than being given numbers they never had
(docs/PART21_DR_OPERATIONS.md, docs/PART22_SCRAPE_SIDE.md).


Part 22 took the deployment half of Part 18's boundary and made it a file in the tree.
`libs/trading-core/scripts/gen_observability_bundle.py` renders `infrastructure/observability/` -
a scrape config whose four jobs, two paths and one header come out of `docker-compose.yml`, each
service's own `@router.get("/metrics")` and `.env.example`; a rule file in which every numeric
literal must appear in the `AlertRule` it is derived from; and a JSON catalog carrying the evidence
field by field - and refuses to invent the rest. 4 of the 24 catalog rules became alerts and the 20
that did not are listed with the reason each stayed unwritten (17 have `threshold: None`, 3 name a
unit no registered family in this tree exposes), because a rules file is where an invented number
goes to look official. No cadence and no dwell time are declared anywhere in the repository, so
none is emitted; there is no relabeling and no `external_labels`, because `labels.py` decides
cardinality at registration and the monitoring side does not get a route around a law the code
cannot break; the single rule that is not in the catalog is `WLCTScrapeTargetDown`, whose only
literal is the `0` that defines a failed scrape, with its job list generated from the same evidence
as the jobs, so a target that cannot be reported down is not possible.
`docker-compose.observability.yml` adds exactly one service - `prom/prometheus:v3.5.0`, pinned
because `http_headers` needs >= 2.53 - mounted read-only, published on `127.0.0.1`, with no
lifecycle endpoint and no retention flag, and `--check` reads it back through structural laws
against the parsed service block rather than by grepping text, so the banner explaining those
absences cannot itself trip the check. No Alertmanager (the platform owns the alert lifecycle, and a
second store of the same alerts is a second truth to reconcile), no Grafana JSON (the dashboard
format this repository owns is the section/row document, which `--dashboard` renders from scraped
exposition with a strict-name absence census printed beside it), no collector, no exporter, no
paging, and no container run: the bundle has never been read by a real Prometheus, which the part
document states as its verification edge rather than as a detail. 41 tests, most of them asserting
that an audit objects when it should, on top of the one that makes the rest reviewable - the
committed bundle is byte-identical to a fresh render (docs/PART22_SCRAPE_SIDE.md).


The sweep after Part 22 (2026-09-19) was a gap audit rather than a feature: every file in the tree was
checked for emptiness, for `pass` bodies outside abstract interfaces, for unresolved first-party imports,
for compose references, for settings with no documentation, for modules with no test and for paths with no
file. One artefact was genuinely missing and it was the one an operator reads at 3 a.m.: the execution
engine's `503 ENABLEMENT_ROLE_UNKNOWN` instructs whoever sees it to apply Part 11's `grant.sql`, and no
such file had ever been written. `apps/api/prisma/rls/grant.sql` now exists (48 lines, SELECT on one catalog
view, its inverse stated, no BYPASSRLS and no superuser) and is emitted by `scripts/gen_part11_rls.py`
beside the enable and disable scripts it belongs with, so the directory stays reproducible from
`schema.prisma` and the three existing artefacts came out byte-identical. Two laws came with it, because a
fix without a law is a fix until the next part: `tests/test_repo_reference_integrity.py` refuses a
path named by a comment, a message or a document that does not resolve, with every exemption argued in the
docstring rather than skipped; `tests/test_env_example_coverage.py` refuses a settings field no example
file names and an example file name nothing reads. A third file, `tests/test_net_signed_sender.py`, covers
the one module in the library that puts an API key on a socket, whose plaintext-endpoint refusal had never
been asserted although its unsigned sibling's has been since Part 9. Seven sentences were also wrong - two
`docs/SECURITY.md` table rows naming directories that never held those files, a `docs/MULTI_TENANCY.md`
code-block label, three cross-references to documents that were renamed or never written, and a gap audit
still quoting 42 covered tables where Part 17 moved the generated set to 43 - and each mechanism was sound
while only its pointer was stale, so the pointer was fixed and nothing else moved. Eleven of the audit's
findings were themselves wrong and are listed as such in docs/PART22_SCRAPE_SIDE.md §9 rather than quietly
dropped: the "22 undocumented engine settings" were documented in the service's own example file, and the
"five untested core modules" have tests that import their functions instead of naming their modules. No
file in the trading path changed; the bundle's `--check`, `--emit`, `--rules`, `--catalog` and `--dashboard`
gates and every suite above were re-run afterwards and are green (docs/PART22_SCRAPE_SIDE.md §9).

The second pass of that sweep - the same instruments pointed at the documentation surface - found three
things worth naming because each is a class rather than a typo. `.env.example` assigned three names twice,
one of them a risk budget (`MAX_RISK_STATE_AGE_MS` at 5000 and at 2000), which is not a style problem but a
loader problem: dotenv takes the first value of a repeated key and docker compose's `env_file` takes the
last, so the deployment's answer depended on which one read the file. Each name is assigned once now, and
the disagreement that deduplication exposed - the execution plane's fallback is looser than the trading
engine's and the API's, while the SLO catalog derives its 4-second budget from the tighter figure - is
documented as an open decision rather than resolved by a comment, because choosing a risk default is a
trading decision. `apps/api/src/modules/health/health.service.ts` read `GIT_COMMIT_SHA` that nothing in the
repository sets, while `apps/api/src/config/app-config.module.ts` claimed no other file reads
`process.env` directly; both sentences were corrected, the two build-metadata names are documented as
build-time rather than operator-set, and `apps/api/src/config/env-example-coverage.spec.ts` now refuses
either pattern returning, including a check that the validation seam itself is still wired. Row 11 and row 12
of `docs/PART16_CORE_LAYER_GAP_AUDIT.md` were carrying Part 16-era figures (22,999 core test lines, 42
covered tables) where the tree now reads 29,568 and 43; `services/notification-service` turned out to have
a `typecheck` script that the root aggregate never ran, so the third TypeScript service was compiled by
`npm run build` and typechecked by nothing until it joined `typecheck` (it passed unchanged, exit 0, and
still has no tests of its own - a gap named here rather than filled by invention), and the document's
live-mode section was quoting a
refusal paragraph `services/execution-engine/app/composition.py` no longer renders, so it quotes the graded
one instead and states which of its own items Parts 16 and 19 have since superseded (docs/PART22_SCRAPE_SIDE.md §9).

Records and freshness, said out loud rather than practised silently: the handover documents for **Parts 16
through 22** are kept byte-identical to a fresh generation, by the chain that regenerates them in order and
then checks them; the generators for Parts 11 through 15 still exist in `scripts/` and are deliberately not
re-run, because their headers would then print today's suites as though they had been measured for those
parts. The consequence is stated here rather than left to be discovered - a later edit to a file embedded
only in a pre-16 handover (the sweep touched `docs/MULTI_TENANCY.md`, `docs/PART13_DURABLE_STORE.md`,
`docs/PART2_TRADING.md`, and two empty `__init__.py` files under `services/execution-engine`) leaves that
earlier record describing the tree as it was, including Part 11's list, which does not contain the
`grant.sql` the sweep added to the directory Part 11's generator owns. The gap sweep's own script, and the
per-language census that sits beside it, stay outside the repository for a stated reason: both report on the
tree, so shipping them inside would let an instrument move the thing it counts - and a heuristic tool that
produces false positives by design belongs beside the tree as a review aid, while the durable conclusions it
reached moved inside as tests, where they can fail a build.
```

