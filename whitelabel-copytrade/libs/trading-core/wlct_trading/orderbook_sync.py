"""Order-book synchronisation: snapshot, buffered diffs, gap recovery.

:class:`~wlct_trading.order_book.OrderBook` from Part 2 already validates
sequences and refuses to apply a delta across a gap. What it deliberately does
*not* do is decide how to get back into sync — that requires a REST call, a
buffer and a retry policy, none of which belong inside a hot in-memory data
structure. This module is that orchestration layer.

The bootstrap race
------------------
The naive sequence — fetch a snapshot, then start streaming — is broken. Between
the snapshot being taken and the stream being attached, updates are lost, and
the book silently diverges from the venue's. It looks fine, prices look
plausible, and every decision made against it is wrong.

The correct protocol, which is what this implements:

1. Attach to the diff stream **first** and buffer everything.
2. Fetch the REST snapshot, which carries a ``last_update_id``.
3. Discard buffered diffs entirely older than the snapshot.
4. Verify that some buffered diff *brackets* ``last_update_id + 1``. If none
   does, the snapshot is older than the buffer and the attempt is retried;
   proceeding here is exactly how a hole gets baked into the book.
5. Apply the snapshot, then replay the surviving buffer in order.
6. Go live.

Fail closed
-----------
Until the book reaches :attr:`SyncPhase.LIVE` it is not tradeable, and
:meth:`OrderBookSynchroniser.is_tradeable` says so. A gap mid-stream drops the
book straight back to buffering. There is no state in which a partially
synchronised book is offered to a strategy as if it were good.
"""

from __future__ import annotations

import asyncio
import dataclasses
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Awaitable, Callable

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderBookHealth
from wlct_trading.market_data import BookTop, OrderBookDelta, OrderBookSnapshot
from wlct_trading.order_book import OrderBook
from wlct_trading.transport.backoff import BackoffConfig, ExponentialBackoff

__all__ = [
    "SyncPhase",
    "SyncConfig",
    "SyncOutcome",
    "SyncStatistics",
    "SnapshotFetcher",
    "OrderBookSynchroniser",
]


class SyncPhase(str, Enum):
    """Where a book is in its synchronisation lifecycle."""

    #: No stream attached; nothing is happening.
    IDLE = "IDLE"
    #: Diffs are being buffered while a snapshot is fetched.
    BUFFERING = "BUFFERING"
    #: Snapshot received; buffer is being reconciled and replayed.
    APPLYING = "APPLYING"
    #: Book is in sync and safe to trade against.
    LIVE = "LIVE"
    #: Resync attempts exhausted. Terminal until explicitly restarted.
    FAILED = "FAILED"


#: Fetches a depth snapshot for one symbol at a requested depth.
SnapshotFetcher = Callable[[str, int], Awaitable[OrderBookSnapshot]]


@dataclass(slots=True, frozen=True)
class SyncConfig:
    """Tuning for one synchroniser."""

    snapshot_depth: int = 1_000
    #: Cap on buffered diffs. A venue firing 100/s fills 5 000 in under a
    #: minute, which is far longer than any healthy snapshot fetch.
    max_buffered_deltas: int = 5_000
    #: Attempts before the book is declared FAILED. Retrying forever against a
    #: venue that is down is how a rate-limit ban is earned.
    max_resync_attempts: int = 10
    backoff: BackoffConfig = field(
        default_factory=lambda: BackoffConfig(
            base_delay_millis=500,
            max_delay_millis=30_000,
            max_attempts=10,
        )
    )
    #: Age beyond which a live book is considered stale even without a gap.
    staleness_threshold_micros: int = 5_000_000

    def __post_init__(self) -> None:
        if self.snapshot_depth <= 0:
            raise ValueError("snapshot_depth must be positive.")
        if self.max_buffered_deltas <= 0:
            raise ValueError("max_buffered_deltas must be positive.")
        if self.max_resync_attempts <= 0:
            raise ValueError("max_resync_attempts must be positive.")


@dataclass(slots=True, frozen=True)
class SyncOutcome:
    """Result of feeding one message to the synchroniser."""

    phase: SyncPhase
    applied: bool
    buffered: bool = False
    resync_triggered: bool = False
    reason: str | None = None
    sequence: int = 0

    @property
    def is_tradeable(self) -> bool:
        return self.phase is SyncPhase.LIVE


@dataclass(slots=True)
class SyncStatistics:
    """Counters for metrics and the admin console."""

    snapshots_fetched: int = 0
    snapshot_failures: int = 0
    resyncs: int = 0
    gaps_detected: int = 0
    deltas_applied: int = 0
    deltas_buffered: int = 0
    deltas_discarded_stale: int = 0
    buffer_overflows: int = 0
    bracket_failures: int = 0
    last_sync_at: int | None = None
    last_gap_at: int | None = None

    def to_dict(self) -> dict[str, int | None]:
        return {
            "snapshotsFetched": self.snapshots_fetched,
            "snapshotFailures": self.snapshot_failures,
            "resyncs": self.resyncs,
            "gapsDetected": self.gaps_detected,
            "deltasApplied": self.deltas_applied,
            "deltasBuffered": self.deltas_buffered,
            "deltasDiscardedStale": self.deltas_discarded_stale,
            "bufferOverflows": self.buffer_overflows,
            "bracketFailures": self.bracket_failures,
            "lastSyncAt": self.last_sync_at,
            "lastGapAt": self.last_gap_at,
        }


class OrderBookSynchroniser:
    """Keeps one :class:`OrderBook` in sync with a venue's diff stream."""

    __slots__ = (
        "_book",
        "_fetcher",
        "_config",
        "_phase",
        "_buffer",
        "_backoff",
        "_stats",
        "_lock",
        "_last_reason",
        "_on_phase_change",
        "_on_resync",
    )

    def __init__(
        self,
        exchange: ExchangeId,
        symbol: str,
        snapshot_fetcher: SnapshotFetcher,
        *,
        config: SyncConfig | None = None,
        on_phase_change: Callable[[SyncPhase, SyncPhase], None] | None = None,
        on_resync: Callable[[str], None] | None = None,
    ) -> None:
        self._book = OrderBook(exchange, symbol)
        self._fetcher = snapshot_fetcher
        self._config = config or SyncConfig()
        self._phase = SyncPhase.IDLE
        self._buffer: deque[OrderBookDelta] = deque()
        # The retry ceiling is derived from max_resync_attempts rather than
        # read from the backoff config. Two independent caps would eventually
        # disagree, and the one that silently won would not be the one an
        # operator configured.
        self._backoff = ExponentialBackoff(
            dataclasses.replace(
                self._config.backoff, max_attempts=self._config.max_resync_attempts
            )
        )
        self._stats = SyncStatistics()
        self._lock = asyncio.Lock()
        self._last_reason: str | None = None
        self._on_phase_change = on_phase_change
        self._on_resync = on_resync

    # ------------------------------------------------------------------
    # Observable state
    # ------------------------------------------------------------------
    @property
    def book(self) -> OrderBook:
        """The underlying book. Check :attr:`is_tradeable` before trusting it."""
        return self._book

    @property
    def phase(self) -> SyncPhase:
        return self._phase

    @property
    def symbol(self) -> str:
        return self._book.symbol

    @property
    def exchange(self) -> ExchangeId:
        return self._book.exchange

    @property
    def statistics(self) -> SyncStatistics:
        return self._stats

    @property
    def buffered_count(self) -> int:
        return len(self._buffer)

    @property
    def last_reason(self) -> str | None:
        return self._last_reason

    @property
    def is_tradeable(self) -> bool:
        """True only when live, healthy and fresh.

        Every condition is required. A book that is LIVE but has not ticked in
        ten seconds is not something to send an order against.
        """
        if self._phase is not SyncPhase.LIVE:
            return False
        if self._book.health is not OrderBookHealth.OK:
            return False
        return not self._book.is_stale(self._config.staleness_threshold_micros)

    def top(self) -> BookTop | None:
        """Top of book, or ``None`` when the book is not trustworthy."""
        if not self.is_tradeable:
            return None
        return self._book.top()

    def _set_phase(self, phase: SyncPhase) -> None:
        if phase is self._phase:
            return
        previous = self._phase
        self._phase = phase
        if self._on_phase_change is not None:
            self._on_phase_change(previous, phase)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def start(self) -> bool:
        """Begin synchronisation. Call once the diff stream is attached."""
        async with self._lock:
            self._set_phase(SyncPhase.BUFFERING)
            self._backoff.reset()
            return await self._synchronise("initial synchronisation")

    async def restart(self) -> bool:
        """Clear a FAILED state and try again. Operator-driven."""
        async with self._lock:
            self._buffer.clear()
            self._backoff.reset()
            self._book.require_resync("operator restart")
            self._set_phase(SyncPhase.BUFFERING)
            return await self._synchronise("operator restart")

    async def resync(self, reason: str, *, discard_buffer: bool = False) -> bool:
        """Force a resync.

        The buffer is **kept** by default. After a mid-stream gap the diffs
        already buffered are still valid and contiguous, and they are what
        allows the incoming snapshot to be bracketed; discarding them would
        lose every update between the snapshot and the next live message, and
        on a busy symbol that provokes another gap immediately — a resync loop.

        Pass ``discard_buffer=True`` when the stream itself is discontinuous,
        which is the case after a socket reconnect: those buffered diffs belong
        to a dead connection and their sequence continuity cannot be assumed.
        """
        async with self._lock:
            return await self._begin_resync(reason, discard_buffer=discard_buffer)

    async def _begin_resync(self, reason: str, *, discard_buffer: bool) -> bool:
        self._last_reason = reason
        self._stats.resyncs += 1
        if discard_buffer:
            self._buffer.clear()
        self._book.require_resync(reason)
        self._set_phase(SyncPhase.BUFFERING)
        self._backoff.reset()
        if self._on_resync is not None:
            self._on_resync(reason)
        return await self._synchronise(reason)

    async def _synchronise(self, reason: str) -> bool:
        """Fetch a snapshot and reconcile it against the buffer.

        Retries with backoff. Returns ``True`` once the book is LIVE.
        """
        while self._backoff.can_retry():
            attempt = self._backoff.attempt + 1
            try:
                snapshot = await self._fetcher(
                    self._book.symbol, self._config.snapshot_depth
                )
                self._stats.snapshots_fetched += 1
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - reported, then retried
                self._stats.snapshot_failures += 1
                self._last_reason = (
                    f"Snapshot fetch failed on attempt {attempt} "
                    f"({reason}): {type(exc).__name__}: {exc}"
                )
                await asyncio.sleep(self._backoff.next_delay_millis() / 1000)
                continue

            self._set_phase(SyncPhase.APPLYING)
            if self._apply_snapshot_and_replay(snapshot):
                self._backoff.reset()
                self._stats.last_sync_at = epoch_micros()
                self._set_phase(SyncPhase.LIVE)
                self._last_reason = None
                return True

            # The snapshot did not bracket the buffer. Back off and refetch;
            # a newer snapshot will.
            self._set_phase(SyncPhase.BUFFERING)
            await asyncio.sleep(self._backoff.next_delay_millis() / 1000)

        self._set_phase(SyncPhase.FAILED)
        self._last_reason = (
            f"Order book for {self._book.exchange.value}:{self._book.symbol} could "
            f"not be synchronised after {self._config.max_resync_attempts} attempts. "
            f"Last reason: {self._last_reason or reason}. The book is not tradeable."
        )
        return False

    def _apply_snapshot_and_replay(self, snapshot: OrderBookSnapshot) -> bool:
        """Reconcile the buffer against a snapshot and replay it.

        Returns ``False`` when the buffer cannot be bracketed, meaning this
        snapshot is unusable and a newer one is needed.
        """
        # Step 3: drop diffs the snapshot already contains.
        stale = 0
        while self._buffer and self._buffer[0].final_update_id <= snapshot.last_update_id:
            self._buffer.popleft()
            stale += 1
        self._stats.deltas_discarded_stale += stale

        # Step 4: prove continuity. With a non-empty buffer the first surviving
        # diff must cover last_update_id + 1; otherwise updates fell between
        # the snapshot and the buffer and the book would start with a hole.
        if self._buffer:
            first = self._buffer[0]
            covers = (
                first.first_update_id <= snapshot.last_update_id + 1
                and first.final_update_id >= snapshot.last_update_id + 1
            )
            if not covers:
                self._stats.bracket_failures += 1
                self._last_reason = (
                    f"Snapshot at {snapshot.last_update_id} does not join the "
                    f"buffer, which resumes at {first.first_update_id}. "
                    f"Refetching rather than applying a book with a hole."
                )
                return False

        # Step 5: snapshot first, then replay in order.
        result = self._book.apply_snapshot(snapshot)
        if not result.applied:
            self._last_reason = result.reason
            return False

        while self._buffer:
            delta = self._buffer.popleft()
            outcome = self._book.apply_delta(delta)
            if outcome.applied:
                self._stats.deltas_applied += 1
                continue
            if outcome.ignored_duplicate:
                continue
            if outcome.resync_required:
                # A gap inside the replay means the buffer itself is holed.
                # Everything from the gap onward is still contiguous and a
                # newer snapshot may well bracket it, so it is put back rather
                # than discarded — throwing it away would force the next
                # attempt to rebuild from nothing and could loop indefinitely
                # on a busy symbol.
                self._stats.gaps_detected += 1
                self._stats.last_gap_at = epoch_micros()
                self._last_reason = (
                    f"Gap while replaying buffered diffs: {outcome.reason}"
                )
                self._buffer.appendleft(delta)
                return False
            self._last_reason = outcome.reason
            return False

        return True

    # ------------------------------------------------------------------
    # Stream input
    # ------------------------------------------------------------------
    def on_delta(self, delta: OrderBookDelta) -> SyncOutcome:
        """Feed one diff. Non-blocking, safe to call from the read loop.

        While buffering, the diff is stored. While live, it is applied and any
        gap flips the book back to buffering — the caller then awaits
        :meth:`resync`, which is why this method never performs I/O itself.
        """
        if self._phase in (SyncPhase.BUFFERING, SyncPhase.APPLYING):
            return self._buffer_delta(delta)

        if self._phase is SyncPhase.FAILED:
            return SyncOutcome(
                phase=self._phase,
                applied=False,
                reason="Book is FAILED; call restart() before feeding diffs.",
                sequence=self._book.sequence,
            )

        if self._phase is SyncPhase.IDLE:
            # Diffs before start() are buffered rather than dropped: the stream
            # is attached first by design.
            self._set_phase(SyncPhase.BUFFERING)
            return self._buffer_delta(delta)

        result = self._book.apply_delta(delta)
        if result.applied:
            self._stats.deltas_applied += 1
            return SyncOutcome(
                phase=self._phase, applied=True, sequence=result.sequence
            )

        if result.ignored_duplicate:
            return SyncOutcome(
                phase=self._phase,
                applied=False,
                reason=result.reason,
                sequence=result.sequence,
            )

        if result.resync_required:
            self._stats.gaps_detected += 1
            self._stats.last_gap_at = epoch_micros()
            self._last_reason = result.reason
            self._set_phase(SyncPhase.BUFFERING)
            self._buffer.clear()
            self._buffer.append(delta)
            self._stats.deltas_buffered += 1
            return SyncOutcome(
                phase=self._phase,
                applied=False,
                buffered=True,
                resync_triggered=True,
                reason=result.reason,
                sequence=result.sequence,
            )

        return SyncOutcome(
            phase=self._phase,
            applied=False,
            reason=result.reason,
            sequence=result.sequence,
        )

    def _buffer_delta(self, delta: OrderBookDelta) -> SyncOutcome:
        """Store a diff, evicting the oldest if the buffer is full.

        Evicting the oldest is correct: the snapshot being fetched will be
        newer than anything at the front, and the tail is what must survive.
        Dropping from the front can break bracketing, so it is counted and the
        synchroniser refetches.
        """
        if len(self._buffer) >= self._config.max_buffered_deltas:
            self._buffer.popleft()
            self._stats.buffer_overflows += 1

        self._buffer.append(delta)
        self._stats.deltas_buffered += 1
        return SyncOutcome(
            phase=self._phase,
            applied=False,
            buffered=True,
            sequence=self._book.sequence,
        )

    def on_snapshot(self, snapshot: OrderBookSnapshot) -> SyncOutcome:
        """Feed an in-stream snapshot, for venues that push one.

        Same reconciliation as the REST path, minus the fetch — so venues using
        ``SNAPSHOT_IN_STREAM`` share the identical replay and bracketing logic
        instead of a parallel implementation.
        """
        self._set_phase(SyncPhase.APPLYING)
        if self._apply_snapshot_and_replay(snapshot):
            self._set_phase(SyncPhase.LIVE)
            self._stats.last_sync_at = epoch_micros()
            self._backoff.reset()
            self._last_reason = None
            return SyncOutcome(
                phase=self._phase, applied=True, sequence=self._book.sequence
            )

        self._set_phase(SyncPhase.BUFFERING)
        return SyncOutcome(
            phase=self._phase,
            applied=False,
            resync_triggered=True,
            reason=self._last_reason,
            sequence=self._book.sequence,
        )

    def health_snapshot(self) -> dict[str, object]:
        """Publishable health record for the admin console."""
        return {
            "exchange": self._book.exchange.value,
            "symbol": self._book.symbol,
            "phase": self._phase.value,
            "bookHealth": self._book.health.value,
            "isTradeable": self.is_tradeable,
            "sequence": self._book.sequence,
            "bufferedDeltas": len(self._buffer),
            "lastReason": self._last_reason,
            "statistics": self._stats.to_dict(),
        }
