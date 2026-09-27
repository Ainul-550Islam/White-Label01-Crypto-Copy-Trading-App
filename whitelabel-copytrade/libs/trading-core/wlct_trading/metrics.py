"""Latency and throughput instrumentation for the connectivity layer.

What is measured, precisely
---------------------------
Three different things get called "latency" and conflating them makes the
numbers meaningless, so they are separate metrics here:

* **feed lag** — venue event timestamp to local receipt. Includes the venue's
  own publishing delay, the network, and clock skew between the two machines.
  Useful as a trend; not a precise measurement, because the two clocks are not
  synchronised. Treated and documented as an estimate.
* **processing latency** — receipt to the point the update is applied and
  visible to a strategy. Measured entirely on one clock, so this one is exact.
* **end-to-end latency** — venue timestamp to strategy visibility. Carries the
  same clock-skew caveat as feed lag.

Honesty about clocks matters. A feed-lag figure computed across two unsynchro-
nised clocks can legitimately come out negative, and this module reports that
rather than clamping it to zero and pretending the data is clean.

No performance guarantees are expressed or implied by anything here. These are
observations of what happened, not commitments about what will.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

from wlct_trading.clock import epoch_micros

__all__ = [
    "LatencyHistogram",
    "CounterSet",
    "TransportCounters",
    "TransportMetrics",
    "StreamMetrics",
    "ConnectivityMetrics",
    "EXECUTION_STAGES",
    "ExecutionCounters",
    "ExecutionMetrics",
    "DATASET_STAGES",
    "DatasetCounters",
    "DatasetMetrics",
    "RISK_STAGES",
    "RiskCounters",
    "RiskMetrics",
]

#: Bucket upper bounds in microseconds: 100µs to ~10s. Fixed buckets keep memory
#: constant regardless of message volume, which a growing list would not.
_DEFAULT_BUCKET_BOUNDS_MICROS: tuple[int, ...] = (
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


class LatencyHistogram:
    """Bucketed latency distribution with a bounded recent-sample window.

    Two structures on purpose. The histogram is cumulative and cheap, giving
    exact counts per bucket over all time. The recent window holds the last N
    raw samples so percentiles reflect current conditions rather than being
    dragged around by an hour-old incident — a p99 that includes yesterday's
    outage tells an operator nothing about right now.
    """

    __slots__ = ("_bounds", "_buckets", "_overflow", "_count", "_sum", "_min", "_max", "_recent")

    def __init__(
        self,
        *,
        bounds: tuple[int, ...] = _DEFAULT_BUCKET_BOUNDS_MICROS,
        window: int = 1_024,
    ) -> None:
        if window <= 0:
            raise ValueError("window must be positive.")
        self._bounds = bounds
        self._buckets = [0] * len(bounds)
        self._overflow = 0
        self._count = 0
        self._sum = 0
        self._min: int | None = None
        self._max: int | None = None
        self._recent: deque[int] = deque(maxlen=window)

    def observe(self, value_micros: int) -> None:
        """Record one measurement. Negative values are kept, not clamped."""
        self._count += 1
        self._sum += value_micros
        self._recent.append(value_micros)
        if self._min is None or value_micros < self._min:
            self._min = value_micros
        if self._max is None or value_micros > self._max:
            self._max = value_micros

        for index, bound in enumerate(self._bounds):
            if value_micros <= bound:
                self._buckets[index] += 1
                return
        self._overflow += 1

    @property
    def count(self) -> int:
        return self._count

    @property
    def mean_micros(self) -> float | None:
        if self._count == 0:
            return None
        return self._sum / self._count

    @property
    def min_micros(self) -> int | None:
        return self._min

    @property
    def max_micros(self) -> int | None:
        return self._max

    def percentile(self, fraction: float) -> int | None:
        """Percentile over the recent window, by nearest-rank.

        ``None`` when nothing has been observed — an honest absence rather than
        a zero that reads like a very fast measurement.
        """
        if not 0.0 < fraction <= 1.0:
            raise ValueError("fraction must be in (0, 1].")
        if not self._recent:
            return None
        ordered = sorted(self._recent)
        rank = max(1, math.ceil(fraction * len(ordered)))
        return ordered[rank - 1]

    def snapshot_buckets(
        self,
    ) -> tuple[tuple[int, ...], tuple[int, ...], int, int]:
        """Whole-state snapshot for the observability exposition adapter.

        ``(bounds, per-bucket counts, total count, total sum micros)``. The
        overflow bucket is deliberately absent: a Prometheus histogram's
        ``+Inf`` line equals ``count``, so the overflow is implicitly
        included, and exposing it separately would let the two views
        disagree. Read-only by contract - the adapter copies, never mutates.
        """
        return self._bounds, tuple(self._buckets), self._count, self._sum

    def to_dict(self) -> dict[str, object]:
        return {
            "count": self._count,
            "meanMicros": self.mean_micros,
            "minMicros": self._min,
            "maxMicros": self._max,
            "p50Micros": self.percentile(0.50),
            "p95Micros": self.percentile(0.95),
            "p99Micros": self.percentile(0.99),
            "windowSize": len(self._recent),
            "buckets": {
                f"<={bound}": self._buckets[index]
                for index, bound in enumerate(self._bounds)
            },
            "overflow": self._overflow,
        }

    def reset(self) -> None:
        self._buckets = [0] * len(self._bounds)
        self._overflow = 0
        self._count = 0
        self._sum = 0
        self._min = None
        self._max = None
        self._recent.clear()


@dataclass(slots=True)
class CounterSet:
    """Monotonic event counters for one stream."""

    messages: int = 0
    parse_errors: int = 0
    dropped: int = 0
    gaps: int = 0
    resyncs: int = 0
    stale_transitions: int = 0
    reconnects: int = 0
    subscription_failures: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "messages": self.messages,
            "parseErrors": self.parse_errors,
            "dropped": self.dropped,
            "gaps": self.gaps,
            "resyncs": self.resyncs,
            "staleTransitions": self.stale_transitions,
            "reconnects": self.reconnects,
            "subscriptionFailures": self.subscription_failures,
        }


@dataclass(slots=True)
class TransportCounters:
    """Connection-level counters for one venue connection.

    Separate from :class:`CounterSet` because these describe the socket, not a
    stream: a single connection carries many streams, and attributing a
    disconnect to one arbitrary symbol would make both numbers wrong.
    """

    connection_attempts: int = 0
    connection_successes: int = 0
    connection_failures: int = 0
    disconnects: int = 0
    reconnects: int = 0
    frames_received: int = 0
    bytes_received: int = 0
    frames_sent: int = 0
    parse_errors: int = 0
    heartbeat_failures: int = 0
    snapshot_requests: int = 0
    snapshot_failures: int = 0
    book_resyncs: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "connectionAttempts": self.connection_attempts,
            "connectionSuccesses": self.connection_successes,
            "connectionFailures": self.connection_failures,
            "disconnects": self.disconnects,
            "reconnects": self.reconnects,
            "framesReceived": self.frames_received,
            "bytesReceived": self.bytes_received,
            "framesSent": self.frames_sent,
            "parseErrors": self.parse_errors,
            "heartbeatFailures": self.heartbeat_failures,
            "snapshotRequests": self.snapshot_requests,
            "snapshotFailures": self.snapshot_failures,
            "bookResyncs": self.book_resyncs,
        }


@dataclass(slots=True)
class TransportMetrics:
    """Transport counters plus the REST snapshot latency distribution.

    Snapshot latency is measured entirely on the local clock — request sent to
    response parsed — so unlike feed lag it carries no clock-skew caveat. It
    still says nothing about the venue's internal processing time, and nothing
    here should be read as a service-level commitment.
    """

    exchange: str
    counters: TransportCounters = field(default_factory=TransportCounters)
    snapshot_latency: LatencyHistogram = field(default_factory=LatencyHistogram)
    connected_since: int | None = None
    last_disconnect_at: int | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "exchange": self.exchange,
            "counters": self.counters.to_dict(),
            "snapshotLatencyMicros": self.snapshot_latency.to_dict(),
            "connectedSince": self.connected_since,
            "lastDisconnectAt": self.last_disconnect_at,
        }


@dataclass(slots=True)
class StreamMetrics:
    """Everything measured for one ``(exchange, channel, symbol)`` stream."""

    exchange: str
    channel: str
    symbol: str
    counters: CounterSet = field(default_factory=CounterSet)
    feed_lag: LatencyHistogram = field(default_factory=LatencyHistogram)
    processing: LatencyHistogram = field(default_factory=LatencyHistogram)
    end_to_end: LatencyHistogram = field(default_factory=LatencyHistogram)
    first_message_at: int | None = None
    last_message_at: int | None = None

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.exchange, self.channel, self.symbol)

    def record_message(
        self,
        *,
        exchange_timestamp: int | None,
        received_timestamp: int,
        processed_timestamp: int | None = None,
    ) -> None:
        """Record one message and its timings."""
        self.counters.messages += 1
        if self.first_message_at is None:
            self.first_message_at = received_timestamp
        self.last_message_at = received_timestamp

        if exchange_timestamp is not None and exchange_timestamp > 0:
            self.feed_lag.observe(received_timestamp - exchange_timestamp)

        if processed_timestamp is not None:
            self.processing.observe(processed_timestamp - received_timestamp)
            if exchange_timestamp is not None and exchange_timestamp > 0:
                self.end_to_end.observe(processed_timestamp - exchange_timestamp)

    def messages_per_second(self, *, now_micros: int | None = None) -> float | None:
        """Average rate since the first message. ``None`` below two samples."""
        if self.first_message_at is None or self.counters.messages < 2:
            return None
        now = epoch_micros() if now_micros is None else now_micros
        elapsed = now - self.first_message_at
        if elapsed <= 0:
            return None
        return self.counters.messages / (elapsed / 1_000_000)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        return {
            "exchange": self.exchange,
            "channel": self.channel,
            "symbol": self.symbol,
            "counters": self.counters.to_dict(),
            "feedLagMicros": self.feed_lag.to_dict(),
            "processingMicros": self.processing.to_dict(),
            "endToEndMicros": self.end_to_end.to_dict(),
            "messagesPerSecond": self.messages_per_second(now_micros=now_micros),
            "firstMessageAt": self.first_message_at,
            "lastMessageAt": self.last_message_at,
        }


class ConnectivityMetrics:
    """Registry of per-stream metrics for one service instance.

    In-process and in-memory by design. Shipping every measurement to a metrics
    backend synchronously would put a network call in the hot path — the exact
    thing the data-plane rules forbid. A collector scrapes :meth:`to_dict` on
    its own schedule instead.
    """

    __slots__ = ("_streams", "_started_at", "_transports")

    def __init__(self) -> None:
        self._streams: dict[tuple[str, str, str], StreamMetrics] = {}
        self._transports: dict[str, TransportMetrics] = {}
        self._started_at = epoch_micros()

    def transport(self, exchange: str) -> TransportMetrics:
        """Get or create the transport record for a venue connection."""
        metrics = self._transports.get(exchange)
        if metrics is None:
            metrics = TransportMetrics(exchange=exchange)
            self._transports[exchange] = metrics
        return metrics

    # ------------------------------------------------------------------
    # Transport-level recording
    # ------------------------------------------------------------------
    def record_connection_attempt(self, exchange: str) -> None:
        self.transport(exchange).counters.connection_attempts += 1

    def record_connection_success(
        self, exchange: str, *, at_micros: int | None = None
    ) -> None:
        metrics = self.transport(exchange)
        metrics.counters.connection_successes += 1
        metrics.connected_since = (
            epoch_micros() if at_micros is None else at_micros
        )

    def record_connection_failure(self, exchange: str) -> None:
        self.transport(exchange).counters.connection_failures += 1

    def record_disconnect(
        self, exchange: str, *, at_micros: int | None = None
    ) -> None:
        metrics = self.transport(exchange)
        metrics.counters.disconnects += 1
        metrics.connected_since = None
        metrics.last_disconnect_at = (
            epoch_micros() if at_micros is None else at_micros
        )

    def record_transport_reconnect(self, exchange: str) -> None:
        self.transport(exchange).counters.reconnects += 1

    def record_frame(self, exchange: str, *, byte_count: int = 0) -> None:
        counters = self.transport(exchange).counters
        counters.frames_received += 1
        counters.bytes_received += max(0, byte_count)

    def record_bytes(self, exchange: str, byte_count: int) -> None:
        self.transport(exchange).counters.bytes_received += max(0, byte_count)

    def record_frame_sent(self, exchange: str) -> None:
        self.transport(exchange).counters.frames_sent += 1

    def record_transport_parse_error(self, exchange: str) -> None:
        self.transport(exchange).counters.parse_errors += 1

    def record_heartbeat_failure(self, exchange: str) -> None:
        self.transport(exchange).counters.heartbeat_failures += 1

    def record_snapshot_request(
        self, exchange: str, *, latency_micros: int | None = None, success: bool = True
    ) -> None:
        """Record one REST order-book snapshot fetch.

        Failures are counted but contribute no latency sample: a timeout's
        duration is a property of the timeout setting, and mixing it into the
        distribution would make the numbers describe the configuration rather
        than the venue.
        """
        metrics = self.transport(exchange)
        metrics.counters.snapshot_requests += 1
        if not success:
            metrics.counters.snapshot_failures += 1
            return
        if latency_micros is not None:
            metrics.snapshot_latency.observe(latency_micros)

    def record_book_resync(self, exchange: str) -> None:
        self.transport(exchange).counters.book_resyncs += 1

    def stream(self, exchange: str, channel: str, symbol: str) -> StreamMetrics:
        """Get or create the metrics record for a stream."""
        key = (exchange, channel, symbol)
        metrics = self._streams.get(key)
        if metrics is None:
            metrics = StreamMetrics(exchange=exchange, channel=channel, symbol=symbol)
            self._streams[key] = metrics
        return metrics

    def record_message(
        self,
        exchange: str,
        channel: str,
        symbol: str,
        *,
        exchange_timestamp: int | None,
        received_timestamp: int,
        processed_timestamp: int | None = None,
    ) -> None:
        self.stream(exchange, channel, symbol).record_message(
            exchange_timestamp=exchange_timestamp,
            received_timestamp=received_timestamp,
            processed_timestamp=processed_timestamp,
        )

    def record_gap(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.gaps += 1

    def record_resync(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.resyncs += 1

    def record_parse_error(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.parse_errors += 1

    def record_drop(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.dropped += 1

    def record_stale_transition(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.stale_transitions += 1

    def record_reconnect(self, exchange: str, channel: str, symbol: str) -> None:
        self.stream(exchange, channel, symbol).counters.reconnects += 1

    def record_subscription_failure(
        self, exchange: str, channel: str, symbol: str
    ) -> None:
        self.stream(exchange, channel, symbol).counters.subscription_failures += 1

    @property
    def stream_count(self) -> int:
        return len(self._streams)

    def totals(self) -> dict[str, int]:
        """Summed counters across every stream."""
        total = CounterSet()
        for metrics in self._streams.values():
            total.messages += metrics.counters.messages
            total.parse_errors += metrics.counters.parse_errors
            total.dropped += metrics.counters.dropped
            total.gaps += metrics.counters.gaps
            total.resyncs += metrics.counters.resyncs
            total.stale_transitions += metrics.counters.stale_transitions
            total.reconnects += metrics.counters.reconnects
            total.subscription_failures += metrics.counters.subscription_failures
        return total.to_dict()

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        """Scrapeable snapshot.

        Percentiles are labelled ``observed`` to make clear they describe past
        measurements on this instance and are not a service-level guarantee.
        """
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "startedAt": self._started_at,
            "uptimeMicros": now - self._started_at,
            "streamCount": len(self._streams),
            "totals": self.totals(),
            "transports": [
                self._transports[exchange].to_dict()
                for exchange in sorted(self._transports)
            ],
            "observed": [
                metrics.to_dict(now_micros=now)
                for metrics in sorted(self._streams.values(), key=lambda m: m.key)
            ],
        }

    def transport_totals(self) -> dict[str, int]:
        """Summed transport counters across every venue connection."""
        total = TransportCounters()
        for metrics in self._transports.values():
            counters = metrics.counters
            total.connection_attempts += counters.connection_attempts
            total.connection_successes += counters.connection_successes
            total.connection_failures += counters.connection_failures
            total.disconnects += counters.disconnects
            total.reconnects += counters.reconnects
            total.frames_received += counters.frames_received
            total.bytes_received += counters.bytes_received
            total.frames_sent += counters.frames_sent
            total.parse_errors += counters.parse_errors
            total.heartbeat_failures += counters.heartbeat_failures
            total.snapshot_requests += counters.snapshot_requests
            total.snapshot_failures += counters.snapshot_failures
            total.book_resyncs += counters.book_resyncs
        return total.to_dict()

    def reset(self) -> None:
        self._streams.clear()
        self._transports.clear()
        self._started_at = epoch_micros()


# ----------------------------------------------------------------------
# Part 5: execution-path instrumentation
# ----------------------------------------------------------------------
#: Named stages of the order pipeline, measured independently.
#:
#: They are separate histograms rather than one end-to-end number because the
#: remedies differ entirely: a slow risk stage is a database problem, a slow
#: signing stage is a CPU problem, and a slow network stage is somebody else's
#: problem. A single aggregate hides which.
EXECUTION_STAGES: tuple[str, ...] = (
    "validation",
    "risk",
    "safety_gates",
    "lock_acquire",
    "signing",
    "placement_review",
    "network",
    "exchange_ack",
    "persistence",
    "total_submit",
    "first_fill",
    "private_stream_delivery",
    "reconciliation_pass",
)


@dataclass(slots=True)
class ExecutionCounters:
    """Monotonic counters for the execution path.

    Every field answers a question an operator actually asks during an
    incident: how many orders did we send, how many did the venue refuse, and —
    the one that matters most — how many are in an unknown state right now.
    """

    orders_submitted: int = 0
    orders_accepted: int = 0
    orders_rejected_locally: int = 0
    orders_rejected_by_exchange: int = 0
    orders_duplicate: int = 0
    orders_dry_run: int = 0
    orders_unknown: int = 0
    orders_cancelled: int = 0
    fills_applied: int = 0
    fills_deduplicated: int = 0
    validation_failures: int = 0
    risk_rejections: int = 0
    kill_switch_blocks: int = 0
    signing_failures: int = 0
    clock_skew_rejections: int = 0
    auth_failures: int = 0
    #: Part 16. The review runs before transmission, so these three answer the
    #: only questions it raises: did we check, did the check stop us, and did the
    #: check fail to get an answer at all (which is a venue/network incident, not
    #: an authorisation one, and must be countable separately).
    placement_reviews: int = 0
    placement_review_blocks: int = 0
    placement_attestation_failures: int = 0
    #: Part 19, and the reason they exist: the three counters above answer "did we
    #: check, did it stop us, did the check fail to get an answer" and cannot answer
    #: "what should we fix". A deployment whose blocks are all PROVENANCE has an
    #: attestor problem; one whose blocks are all CREDENTIAL has a key problem; the
    #: total is identical in both and the pages look the same. These are the review's
    #: :class:`~wlct_trading.execution.placement_review.ReviewArea` axis, one field
    #: per area, incremented once per blocking finding.
    #:
    #: ``placement_blocks_unclassified`` is a counter and not an oversight: a code
    #: nobody assigned an area must land somewhere that is visible, because the
    #: moment it is quietly dropped the axis stops being a measurement of the review
    #: and starts being a measurement of the table.
    placement_blocks_provenance: int = 0
    placement_blocks_credential: int = 0
    placement_blocks_account: int = 0
    placement_blocks_symbol: int = 0
    placement_blocks_clock: int = 0
    placement_blocks_confirmation: int = 0
    placement_blocks_unclassified: int = 0
    rate_limit_refusals: int = 0
    reconciliation_passes: int = 0
    reconciliation_failures: int = 0
    discrepancies_found: int = 0
    discrepancies_repaired: int = 0
    incidents_raised: int = 0
    private_stream_reconnects: int = 0
    private_stream_events: int = 0
    listen_key_renewals: int = 0
    listen_key_renewal_failures: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "ordersSubmitted": self.orders_submitted,
            "ordersAccepted": self.orders_accepted,
            "ordersRejectedLocally": self.orders_rejected_locally,
            "ordersRejectedByExchange": self.orders_rejected_by_exchange,
            "ordersDuplicate": self.orders_duplicate,
            "ordersDryRun": self.orders_dry_run,
            "ordersUnknown": self.orders_unknown,
            "ordersCancelled": self.orders_cancelled,
            "fillsApplied": self.fills_applied,
            "fillsDeduplicated": self.fills_deduplicated,
            "validationFailures": self.validation_failures,
            "riskRejections": self.risk_rejections,
            "killSwitchBlocks": self.kill_switch_blocks,
            "signingFailures": self.signing_failures,
            "clockSkewRejections": self.clock_skew_rejections,
            "authFailures": self.auth_failures,
            "placementReviews": self.placement_reviews,
            "placementReviewBlocks": self.placement_review_blocks,
            "placementAttestationFailures": self.placement_attestation_failures,
            "placementBlocksProvenance": self.placement_blocks_provenance,
            "placementBlocksCredential": self.placement_blocks_credential,
            "placementBlocksAccount": self.placement_blocks_account,
            "placementBlocksSymbol": self.placement_blocks_symbol,
            "placementBlocksClock": self.placement_blocks_clock,
            "placementBlocksConfirmation": self.placement_blocks_confirmation,
            "placementBlocksUnclassified": self.placement_blocks_unclassified,
            "rateLimitRefusals": self.rate_limit_refusals,
            "reconciliationPasses": self.reconciliation_passes,
            "reconciliationFailures": self.reconciliation_failures,
            "discrepanciesFound": self.discrepancies_found,
            "discrepanciesRepaired": self.discrepancies_repaired,
            "incidentsRaised": self.incidents_raised,
            "privateStreamReconnects": self.private_stream_reconnects,
            "privateStreamEvents": self.private_stream_events,
            "listenKeyRenewals": self.listen_key_renewals,
            "listenKeyRenewalFailures": self.listen_key_renewal_failures,
        }


class ExecutionMetrics:
    """Latency distributions and counters for the authenticated path.

    These are **observations**, not guarantees. The figures include this
    process's own scheduling delay, the venue's queueing, and the internet in
    between. They are useful for spotting a regression and for capacity
    planning, and they are not a service-level guarantee of any kind — this
    platform makes no low-latency promises and none should be inferred from a
    good percentile here.
    """

    __slots__ = ("_stages", "_counters", "_started_at", "_exchange")

    def __init__(self, exchange: str = "") -> None:
        self._exchange = exchange
        self._stages: dict[str, LatencyHistogram] = {
            stage: LatencyHistogram() for stage in EXECUTION_STAGES
        }
        self._counters = ExecutionCounters()
        self._started_at = epoch_micros()

    @property
    def counters(self) -> ExecutionCounters:
        return self._counters

    def observe(self, stage: str, micros: int) -> None:
        """Record one measurement for a named stage.

        An unknown stage name is created on demand rather than dropped: losing
        a measurement because a new stage was added in one place and not the
        other is a silent failure, and a stray key in a metrics dump is not.
        """
        histogram = self._stages.get(stage)
        if histogram is None:
            histogram = LatencyHistogram()
            self._stages[stage] = histogram
        histogram.observe(micros)

    def stage(self, name: str) -> LatencyHistogram | None:
        return self._stages.get(name)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "exchange": self._exchange,
            "uptimeMicros": now - self._started_at,
            "counters": self._counters.to_dict(),
            "stages": {
                name: histogram.to_dict()
                for name, histogram in sorted(self._stages.items())
                if histogram.count > 0
            },
            "note": (
                "Latency figures are observations of this process and its "
                "network path. They are not a performance guarantee."
            ),
        }

    def reset(self) -> None:
        for histogram in self._stages.values():
            histogram.reset()
        self._counters = ExecutionCounters()
        self._started_at = epoch_micros()


#: Stages measured on the strategy path. Same caveat as ``EXECUTION_STAGES``:
#: these are observations of this process, never a guarantee.
STRATEGY_STAGES: tuple[str, ...] = (
    "feature_calculation",
    "strategy_processing",
    "signal_validation",
    "simulated_execution",
    "paper_dispatch",
    "backtest_run",
)


@dataclass(slots=True)
class StrategyCounters:
    """Monotonic counters for the strategy, paper and backtest layers.

    Kept in one counter set rather than three because an operator diagnosing
    "why did this strategy stop trading?" needs the strategy, validation and
    simulation numbers on one screen, and splitting them across registries
    would make that a join.
    """

    instances_registered: int = 0
    instances_started: int = 0
    instances_stopped: int = 0
    instances_failed: int = 0
    instances_quarantined: int = 0
    engine_halts: int = 0
    events_processed: int = 0
    timer_ticks: int = 0
    signals_generated: int = 0
    signals_accepted: int = 0
    signals_rejected: int = 0
    signals_deduplicated: int = 0
    strategy_errors: int = 0
    feature_errors: int = 0
    feature_resets: int = 0
    provider_errors: int = 0
    slow_dispatches: int = 0
    risk_rejections: int = 0
    simulated_orders: int = 0
    simulated_fills: int = 0
    simulated_orders_rejected: int = 0
    paper_sessions_started: int = 0
    paper_sessions_stopped: int = 0
    backtests_completed: int = 0
    replay_events: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "instancesRegistered": self.instances_registered,
            "instancesStarted": self.instances_started,
            "instancesStopped": self.instances_stopped,
            "instancesFailed": self.instances_failed,
            "instancesQuarantined": self.instances_quarantined,
            "engineHalts": self.engine_halts,
            "eventsProcessed": self.events_processed,
            "timerTicks": self.timer_ticks,
            "signalsGenerated": self.signals_generated,
            "signalsAccepted": self.signals_accepted,
            "signalsRejected": self.signals_rejected,
            "signalsDeduplicated": self.signals_deduplicated,
            "strategyErrors": self.strategy_errors,
            "featureErrors": self.feature_errors,
            "featureResets": self.feature_resets,
            "providerErrors": self.provider_errors,
            "slowDispatches": self.slow_dispatches,
            "riskRejections": self.risk_rejections,
            "simulatedOrders": self.simulated_orders,
            "simulatedFills": self.simulated_fills,
            "simulatedOrdersRejected": self.simulated_orders_rejected,
            "paperSessionsStarted": self.paper_sessions_started,
            "paperSessionsStopped": self.paper_sessions_stopped,
            "backtestsCompleted": self.backtests_completed,
            "replayEvents": self.replay_events,
        }


class StrategyMetrics:
    """Counters and latency distributions for the Part 6 strategy layer.

    Mirrors :class:`ExecutionMetrics` in shape so an operator reads both the
    same way, and carries the same warning: every figure is an observation of
    what this process did, including its own scheduling delay. Nothing here is
    a latency guarantee, and a good percentile is not a promise about the next
    event.

    In-process and in-memory. No metric is shipped synchronously, because a
    network call on the strategy path is exactly what the data-plane rules
    forbid.
    """

    __slots__ = ("_stages", "_counters", "_started_at")

    def __init__(self) -> None:
        self._stages: dict[str, LatencyHistogram] = {
            stage: LatencyHistogram() for stage in STRATEGY_STAGES
        }
        self._counters = StrategyCounters()
        self._started_at = epoch_micros()

    @property
    def counters(self) -> StrategyCounters:
        return self._counters

    def observe(self, stage: str, micros: int) -> None:
        """Record one measurement. Unknown stages are created on demand."""
        histogram = self._stages.get(stage)
        if histogram is None:
            histogram = LatencyHistogram()
            self._stages[stage] = histogram
        histogram.observe(micros)

    def stage(self, name: str) -> LatencyHistogram | None:
        return self._stages.get(name)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "uptimeMicros": now - self._started_at,
            "counters": self._counters.to_dict(),
            "stages": {
                name: histogram.to_dict()
                for name, histogram in sorted(self._stages.items())
                if histogram.count > 0
            },
            "note": (
                "Strategy latency figures are observations of this process. "
                "They are not a performance guarantee, and no strategy "
                "profitability is implied by any counter here."
            ),
        }

    def reset(self) -> None:
        for histogram in self._stages.values():
            histogram.reset()
        self._counters = StrategyCounters()
        self._started_at = epoch_micros()


# ---------------------------------------------------------------------------
# Part 7: dataset ingestion, validation and replay measurement
# ---------------------------------------------------------------------------
#: Stages measured on the dataset path. These are throughput observations of
#: the pipeline itself - bytes moved, events transformed - never promises
#: about how fast ingestion will be tomorrow.
DATASET_STAGES: tuple[str, ...] = (
    "discover",
    "fetch",
    "normalize",
    "write_partition",
    "checksum",
    "validate",
    "finalize",
    "replay_stream",
)


@dataclass(slots=True)
class DatasetCounters:
    """Monotonic counters for dataset ingestion, validation and replay.

    Every field is something an operator asks during an incident: did the
    download stall, how many events survived normalisation, did validation
    find duplicates, is a replay reading the dataset it thinks it is reading.
    """

    ingestion_runs_started: int = 0
    ingestion_runs_succeeded: int = 0
    ingestion_runs_failed: int = 0
    bytes_downloaded: int = 0
    events_read: int = 0
    events_written: int = 0
    partitions_written: int = 0
    duplicates_detected: int = 0
    timestamp_gaps: int = 0
    sequence_gaps: int = 0
    validation_warnings: int = 0
    validation_errors: int = 0
    validation_fatal: int = 0
    finalizations: int = 0
    quarantined_versions: int = 0
    replay_events: int = 0
    replay_partitions_read: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "ingestionRunsStarted": self.ingestion_runs_started,
            "ingestionRunsSucceeded": self.ingestion_runs_succeeded,
            "ingestionRunsFailed": self.ingestion_runs_failed,
            "bytesDownloaded": self.bytes_downloaded,
            "eventsRead": self.events_read,
            "eventsWritten": self.events_written,
            "partitionsWritten": self.partitions_written,
            "duplicatesDetected": self.duplicates_detected,
            "timestampGaps": self.timestamp_gaps,
            "sequenceGaps": self.sequence_gaps,
            "validationWarnings": self.validation_warnings,
            "validationErrors": self.validation_errors,
            "validationFatal": self.validation_fatal,
            "finalizations": self.finalizations,
            "quarantinedVersions": self.quarantined_versions,
            "replayEvents": self.replay_events,
            "replayPartitionsRead": self.replay_partitions_read,
        }


class DatasetMetrics:
    """Counters and stage timings for the Part 7 dataset pipeline.

    Same shape and same caveat as :class:`StrategyMetrics`: every figure is an
    observation of this process - including its own I/O scheduling - and
    nothing here is a throughput guarantee. Dataset sizes are bounded by the
    ingestion configuration, so these numbers describe work that is already
    finite; that is deliberate and has nothing to do with speed promises.
    """

    __slots__ = ("_stages", "_counters", "_started_at")

    def __init__(self) -> None:
        self._stages: dict[str, LatencyHistogram] = {
            stage: LatencyHistogram() for stage in DATASET_STAGES
        }
        self._counters = DatasetCounters()
        self._started_at = epoch_micros()

    @property
    def counters(self) -> DatasetCounters:
        return self._counters

    def observe(self, stage: str, micros: int) -> None:
        """Record one measurement. Unknown stages are created on demand."""
        histogram = self._stages.get(stage)
        if histogram is None:
            histogram = LatencyHistogram()
            self._stages[stage] = histogram
        histogram.observe(micros)

    def stage(self, name: str) -> LatencyHistogram | None:
        return self._stages.get(name)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "uptimeMicros": now - self._started_at,
            "counters": self._counters.to_dict(),
            "stages": {
                name: histogram.to_dict()
                for name, histogram in sorted(self._stages.items())
                if histogram.count > 0
            },
            "note": (
                "Dataset throughput figures are observations of this process. "
                "They are not a performance guarantee and imply nothing about "
                "backtest or trading results."
            ),
        }

    def reset(self) -> None:
        for histogram in self._stages.values():
            histogram.reset()
        self._counters = DatasetCounters()
        self._started_at = epoch_micros()


# ---------------------------------------------------------------------------
# Part 8: risk engine
# ---------------------------------------------------------------------------

#: Stages of one gate evaluation, in execution order. These are latency
#: *observations of the decision path*, which is the only latency the risk
#: gate can honestly report; nothing here measures network or venue time.
RISK_STAGES: tuple[str, ...] = (
    "snapshot_retrieval",
    "core_evaluation",
    "snapshot_validation",
    "freshness",
    "kill_switch",
    "exposure",
    "rules",
    "reservation",
    "decision_total",
)


class RiskCounters:
    """Monotonic counters for the risk gate.

    Split by verdict class rather than by rule so the incident questions
    ("are we being rejected because of state, or because of limits?") are
    answerable from one glance; per-rule detail lives in the risk events
    table, not in a metric label set.
    """

    decisions_total: int = 0
    decisions_approved: int = 0
    decisions_rejected: int = 0
    rejected_state_unavailable: int = 0
    rejected_stale: int = 0
    rejected_kill_switch: int = 0
    rejected_limit: int = 0
    rejected_protection: int = 0
    rejected_gate_error: int = 0
    risk_reducing_allowed_under_protection: int = 0
    approaching_limit_warnings: int = 0
    protections_triggered: int = 0
    events_emitted: int = 0
    events_deduplicated: int = 0
    reservations_acquired: int = 0
    reservations_lost: int = 0
    reservations_released: int = 0
    gate_unavailable_rejects: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "decisionsTotal": self.decisions_total,
            "decisionsApproved": self.decisions_approved,
            "decisionsRejected": self.decisions_rejected,
            "rejectedStateUnavailable": self.rejected_state_unavailable,
            "rejectedStale": self.rejected_stale,
            "rejectedKillSwitch": self.rejected_kill_switch,
            "rejectedLimit": self.rejected_limit,
            "rejectedProtection": self.rejected_protection,
            "rejectedGateError": self.rejected_gate_error,
            "riskReducingAllowedUnderProtection": (
                self.risk_reducing_allowed_under_protection
            ),
            "approachingLimitWarnings": self.approaching_limit_warnings,
            "protectionsTriggered": self.protections_triggered,
            "eventsEmitted": self.events_emitted,
            "eventsDeduplicated": self.events_deduplicated,
            "reservationsAcquired": self.reservations_acquired,
            "reservationsLost": self.reservations_lost,
            "reservationsReleased": self.reservations_released,
            "gateUnavailableRejects": self.gate_unavailable_rejects,
        }


class RiskMetrics:
    """Per-stage latency observations and counters for the risk gate.

    Same honesty rule as every other metrics class in this module: numbers
    describe what this process measured about itself. They are not a latency
    guarantee, and a low histogram here says nothing about venue round
    trips, which are outside the gate by construction.
    """

    __slots__ = ("_stages", "_counters", "_started_at")

    def __init__(self) -> None:
        self._stages: dict[str, LatencyHistogram] = {
            stage: LatencyHistogram() for stage in RISK_STAGES
        }
        self._counters = RiskCounters()
        self._started_at = epoch_micros()

    @property
    def counters(self) -> RiskCounters:
        return self._counters

    def observe(self, stage: str, micros: int) -> None:
        """Record one measurement. Unknown stages are created on demand."""
        histogram = self._stages.get(stage)
        if histogram is None:
            histogram = LatencyHistogram()
            self._stages[stage] = histogram
        histogram.observe(micros)

    def stage(self, name: str) -> LatencyHistogram | None:
        return self._stages.get(name)

    def to_dict(self, *, now_micros: int | None = None) -> dict[str, object]:
        now = epoch_micros() if now_micros is None else now_micros
        return {
            "uptimeMicros": now - self._started_at,
            "counters": self._counters.to_dict(),
            "stages": {
                name: histogram.to_dict()
                for name, histogram in sorted(self._stages.items())
                if histogram.count > 0
            },
            "note": (
                "Risk gate latencies are observations of this process's "
                "decision path only. They are not a performance guarantee "
                "and say nothing about venue or network time."
            ),
        }

    def reset(self) -> None:
        for histogram in self._stages.values():
            histogram.reset()
        self._counters = RiskCounters()
        self._started_at = epoch_micros()
