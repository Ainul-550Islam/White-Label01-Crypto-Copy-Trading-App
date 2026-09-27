"""Order-book synchronisation: bootstrap, replay, gap recovery, fail-closed.

This is the highest-consequence logic in the connectivity layer. A book that is
subtly out of sync does not raise anything — it just quietly reports prices that
are not the market's, and every decision downstream inherits the error. So the
tests here are written to catch *silent* divergence, not just crashes.

The snapshot fetcher is a stub returning scripted images, which makes the
bootstrap race — the one that is nearly impossible to reproduce against a live
venue — completely deterministic.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderBookHealth
from wlct_trading.market_data import OrderBookDelta, OrderBookSnapshot, PriceLevel
from wlct_trading.orderbook_sync import (
    OrderBookSynchroniser,
    SyncConfig,
    SyncPhase,
)
from wlct_trading.transport.backoff import BackoffConfig

EXCHANGE = ExchangeId.BINANCE
SYMBOL = "BTC-USDT"


def now() -> int:
    """Current time in microseconds.

    Fixtures are stamped with the real clock rather than a frozen constant
    because :attr:`OrderBookSynchroniser.is_tradeable` genuinely checks
    freshness. A hard-coded 2023 timestamp would make every book look stale and
    the freshness assertions would pass for the wrong reason.

    Determinism is unaffected: the logic under test keys off sequence numbers,
    which are fixed.
    """
    return epoch_micros()


def level(price: str, quantity: str) -> PriceLevel:
    return PriceLevel(price=Decimal(price), quantity=Decimal(quantity))


def snapshot(last_update_id: int, *, bid: str = "100", ask: str = "101") -> OrderBookSnapshot:
    stamp = now()
    return OrderBookSnapshot(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        bids=(level(bid, "1.0"), level(str(Decimal(bid) - 1), "2.0")),
        asks=(level(ask, "1.5"), level(str(Decimal(ask) + 1), "2.5")),
        last_update_id=last_update_id,
        exchange_timestamp=stamp,
        received_timestamp=stamp,
    )


def delta(
    first: int,
    final: int,
    *,
    bids: tuple[PriceLevel, ...] = (),
    asks: tuple[PriceLevel, ...] = (),
    timestamp: int | None = None,
) -> OrderBookDelta:
    stamp = now() if timestamp is None else timestamp
    return OrderBookDelta(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        bids=bids,
        asks=asks,
        first_update_id=first,
        final_update_id=final,
        exchange_timestamp=stamp,
        received_timestamp=stamp,
    )


class SnapshotFetcherStub:
    """Returns scripted snapshots and counts calls."""

    def __init__(self, *snapshots: OrderBookSnapshot, error: BaseException | None = None) -> None:
        self._snapshots = list(snapshots)
        self._error = error
        self.calls: list[tuple[str, int]] = []

    async def __call__(self, symbol: str, depth: int) -> OrderBookSnapshot:
        self.calls.append((symbol, depth))
        if self._error is not None:
            raise self._error
        if not self._snapshots:
            raise AssertionError("Fetcher called more times than scripted.")
        if len(self._snapshots) == 1:
            return self._snapshots[0]
        return self._snapshots.pop(0)

    @property
    def call_count(self) -> int:
        return len(self.calls)


def fast_config(**overrides: object) -> SyncConfig:
    """Sync config with negligible delays so tests do not wait on wall time."""
    defaults: dict[str, object] = {
        "snapshot_depth": 100,
        "backoff": BackoffConfig(
            base_delay_millis=1, max_delay_millis=2, max_attempts=5, jitter=False
        ),
        "max_resync_attempts": 5,
    }
    defaults.update(overrides)
    return SyncConfig(**defaults)  # type: ignore[arg-type]


# ----------------------------------------------------------------------
# 1-5: bootstrap
# ----------------------------------------------------------------------
def test_synchroniser_starts_idle_and_untradeable() -> None:
    fetcher = SnapshotFetcherStub(snapshot(100))
    sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
    assert sync.phase is SyncPhase.IDLE
    assert sync.is_tradeable is False
    assert sync.top() is None


def test_clean_bootstrap_reaches_live() -> None:
    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())

        assert await sync.start() is True
        assert sync.phase is SyncPhase.LIVE
        assert sync.is_tradeable is True
        assert sync.book.sequence == 100
        assert sync.book.best_bid == Decimal("100")
        assert sync.book.best_ask == Decimal("101")

    asyncio.run(scenario())


def test_diffs_arriving_before_start_are_buffered_not_dropped() -> None:
    """The stream is attached before the snapshot is fetched, by design.

    Anything received in that window is exactly the data needed to close the
    bootstrap race, so it must be kept.
    """

    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())

        outcome = sync.on_delta(delta(101, 105, bids=(level("100.5", "3.0"),)))
        assert outcome.buffered is True
        assert sync.buffered_count == 1
        assert sync.phase is SyncPhase.BUFFERING

        await sync.start()
        assert sync.phase is SyncPhase.LIVE
        assert sync.book.sequence == 105
        assert sync.book.best_bid == Decimal("100.5")

    asyncio.run(scenario())


def test_buffered_diffs_older_than_the_snapshot_are_discarded() -> None:
    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())

        sync.on_delta(delta(90, 95))
        sync.on_delta(delta(96, 100))
        sync.on_delta(delta(101, 103, bids=(level("100.7", "1.0"),)))

        await sync.start()
        assert sync.statistics.deltas_discarded_stale == 2
        assert sync.book.sequence == 103

    asyncio.run(scenario())


def test_snapshot_that_does_not_join_the_buffer_is_refetched() -> None:
    """The bracketing rule: U <= lastUpdateId+1 <= u for the first replayed diff.

    A snapshot older than the buffer means updates fell in the hole between
    them. Applying it would bake a permanent error into the book, so a newer
    snapshot is fetched instead.
    """

    async def scenario() -> None:
        # First snapshot is too old: buffer resumes at 200, snapshot is at 100.
        fetcher = SnapshotFetcherStub(snapshot(100), snapshot(205))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())

        sync.on_delta(delta(200, 210, bids=(level("100.9", "1.0"),)))

        assert await sync.start() is True
        assert fetcher.call_count == 2
        assert sync.statistics.bracket_failures == 1
        assert sync.phase is SyncPhase.LIVE
        assert sync.book.sequence == 210

    asyncio.run(scenario())


# ----------------------------------------------------------------------
# 6-10: live operation
# ----------------------------------------------------------------------
def test_live_deltas_are_applied_in_sequence() -> None:
    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
        await sync.start()

        assert sync.on_delta(delta(101, 101, bids=(level("100.2", "5.0"),))).applied
        assert sync.on_delta(delta(102, 102, asks=(level("100.8", "4.0"),))).applied
        assert sync.book.sequence == 102
        assert sync.book.best_bid == Decimal("100.2")
        assert sync.book.best_ask == Decimal("100.8")

    asyncio.run(scenario())


def test_replayed_duplicate_is_ignored_without_resync() -> None:
    """Replays are normal on reconnect and are not an error."""

    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
        await sync.start()
        sync.on_delta(delta(101, 105))

        outcome = sync.on_delta(delta(101, 105))
        assert outcome.applied is False
        assert outcome.resync_triggered is False
        assert sync.phase is SyncPhase.LIVE

    asyncio.run(scenario())


def test_sequence_gap_drops_the_book_out_of_live() -> None:
    """A gap must never be silently absorbed."""

    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
        await sync.start()

        outcome = sync.on_delta(delta(500, 510))
        assert outcome.applied is False
        assert outcome.resync_triggered is True
        assert sync.phase is SyncPhase.BUFFERING
        assert sync.is_tradeable is False
        assert sync.statistics.gaps_detected == 1

    asyncio.run(scenario())


def test_the_gapped_delta_is_retained_for_the_next_replay() -> None:
    """The message that revealed the gap is still valid data."""

    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
        await sync.start()

        sync.on_delta(delta(500, 510))
        assert sync.buffered_count == 1

    asyncio.run(scenario())


def test_recovery_after_a_gap_returns_to_live() -> None:
    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100), snapshot(505))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
        await sync.start()

        sync.on_delta(delta(500, 510, bids=(level("100.75", "9.0"),)))
        assert sync.phase is SyncPhase.BUFFERING

        assert await sync.resync("gap detected") is True
        assert sync.phase is SyncPhase.LIVE
        assert sync.is_tradeable is True
        assert sync.book.sequence == 510

    asyncio.run(scenario())


# ----------------------------------------------------------------------
# 11-15: fail-closed behaviour
# ----------------------------------------------------------------------
def test_book_is_not_tradeable_while_buffering() -> None:
    fetcher = SnapshotFetcherStub(snapshot(100))
    sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
    sync.on_delta(delta(1, 2))
    assert sync.phase is SyncPhase.BUFFERING
    assert sync.is_tradeable is False
    assert sync.top() is None


def test_top_of_book_is_withheld_unless_live_and_fresh() -> None:
    """The safety property: no trustworthy quote, no quote at all.

    Returning a stale top would let a strategy price an order against data it
    has no way of knowing is old.
    """

    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(
            EXCHANGE, SYMBOL, fetcher, config=fast_config(staleness_threshold_micros=1)
        )
        await sync.start()
        await asyncio.sleep(0.01)

        assert sync.phase is SyncPhase.LIVE
        assert sync.is_tradeable is False
        assert sync.top() is None

    asyncio.run(scenario())


def test_exhausted_snapshot_attempts_end_in_failed_not_a_loop() -> None:
    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(error=ConnectionError("venue unreachable"))
        sync = OrderBookSynchroniser(
            EXCHANGE, SYMBOL, fetcher, config=fast_config(max_resync_attempts=3)
        )

        assert await sync.start() is False
        assert sync.phase is SyncPhase.FAILED
        assert sync.is_tradeable is False
        assert sync.statistics.snapshot_failures >= 3
        assert "not tradeable" in (sync.last_reason or "")

    asyncio.run(scenario())


def test_failed_book_refuses_diffs_until_restarted() -> None:
    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(error=ConnectionError("down"))
        sync = OrderBookSynchroniser(
            EXCHANGE, SYMBOL, fetcher, config=fast_config(max_resync_attempts=2)
        )
        await sync.start()
        assert sync.phase is SyncPhase.FAILED

        outcome = sync.on_delta(delta(1, 2))
        assert outcome.applied is False
        assert outcome.buffered is False
        assert "restart" in (outcome.reason or "")

    asyncio.run(scenario())


def test_restart_clears_a_failed_book() -> None:
    async def scenario() -> None:
        class Recovering:
            def __init__(self) -> None:
                self.calls = 0

            async def __call__(self, symbol: str, depth: int) -> OrderBookSnapshot:
                self.calls += 1
                if self.calls <= 2:
                    raise ConnectionError("still down")
                return snapshot(300)

        fetcher = Recovering()
        sync = OrderBookSynchroniser(
            EXCHANGE, SYMBOL, fetcher, config=fast_config(max_resync_attempts=2)
        )
        assert await sync.start() is False
        assert sync.phase is SyncPhase.FAILED

        assert await sync.restart() is True
        assert sync.phase is SyncPhase.LIVE
        assert sync.book.sequence == 300

    asyncio.run(scenario())


# ----------------------------------------------------------------------
# 16-20: buffer management, in-stream snapshots, health
# ----------------------------------------------------------------------
def test_buffer_overflow_evicts_the_oldest_and_is_counted() -> None:
    """Memory must stay bounded even if a snapshot never arrives."""
    fetcher = SnapshotFetcherStub(snapshot(1))
    sync = OrderBookSynchroniser(
        EXCHANGE, SYMBOL, fetcher, config=fast_config(max_buffered_deltas=10)
    )

    for index in range(25):
        sync.on_delta(delta(index * 2, index * 2 + 1))

    assert sync.buffered_count == 10
    assert sync.statistics.buffer_overflows == 15


def test_in_stream_snapshot_uses_the_same_reconciliation_path() -> None:
    """Venues that push a snapshot share the bracketing logic, not a copy."""
    fetcher = SnapshotFetcherStub(snapshot(100))
    sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())

    sync.on_delta(delta(101, 104, bids=(level("100.4", "2.0"),)))
    outcome = sync.on_snapshot(snapshot(100))

    assert outcome.applied is True
    assert sync.phase is SyncPhase.LIVE
    assert sync.book.sequence == 104
    assert fetcher.call_count == 0


def test_in_stream_snapshot_that_does_not_bracket_stays_buffering() -> None:
    fetcher = SnapshotFetcherStub(snapshot(100))
    sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())

    sync.on_delta(delta(900, 910))
    outcome = sync.on_snapshot(snapshot(100))

    assert outcome.applied is False
    assert sync.phase is SyncPhase.BUFFERING
    assert sync.is_tradeable is False


def test_resync_marks_the_book_unusable_before_the_new_snapshot_lands() -> None:
    """There must be no window where a half-rebuilt book looks usable."""

    async def scenario() -> None:
        observed: list[bool] = []

        class Observing:
            async def __call__(self, symbol: str, depth: int) -> OrderBookSnapshot:
                observed.append(sync.is_tradeable)
                return snapshot(400)

        sync = OrderBookSynchroniser(
            EXCHANGE, SYMBOL, Observing(), config=fast_config()
        )
        await sync.start()
        assert sync.is_tradeable is True

        await sync.resync("operator forced")
        assert observed == [False, False]
        assert sync.book.health is OrderBookHealth.OK
        assert sync.is_tradeable is True

    asyncio.run(scenario())


def test_health_snapshot_reports_everything_an_operator_needs() -> None:
    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
        await sync.start()
        sync.on_delta(delta(101, 102))

        health = sync.health_snapshot()
        assert health["exchange"] == "binance"
        assert health["symbol"] == SYMBOL
        assert health["phase"] == SyncPhase.LIVE.value
        assert health["isTradeable"] is True
        assert health["sequence"] == 102
        assert health["statistics"]["deltasApplied"] >= 1

    asyncio.run(scenario())


def test_phase_change_callback_fires_for_observability() -> None:
    async def scenario() -> None:
        transitions: list[tuple[str, str]] = []
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(
            EXCHANGE,
            SYMBOL,
            fetcher,
            config=fast_config(),
            on_phase_change=lambda previous, current: transitions.append(
                (previous.value, current.value)
            ),
        )
        await sync.start()

        assert ("IDLE", "BUFFERING") in transitions
        assert ("APPLYING", "LIVE") in transitions

    asyncio.run(scenario())


def test_resync_callback_reports_the_reason() -> None:
    async def scenario() -> None:
        reasons: list[str] = []
        fetcher = SnapshotFetcherStub(snapshot(100), snapshot(600))
        sync = OrderBookSynchroniser(
            EXCHANGE,
            SYMBOL,
            fetcher,
            config=fast_config(),
            on_resync=reasons.append,
        )
        await sync.start()
        await sync.resync("sequence gap on btcusdt@depth")

        assert reasons == ["sequence gap on btcusdt@depth"]
        assert sync.statistics.resyncs == 1

    asyncio.run(scenario())


def test_snapshot_depth_is_passed_through_to_the_fetcher() -> None:
    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(
            EXCHANGE, SYMBOL, fetcher, config=fast_config(snapshot_depth=500)
        )
        await sync.start()
        assert fetcher.calls == [(SYMBOL, 500)]

    asyncio.run(scenario())


def test_gap_inside_the_replay_is_detected_and_refetched() -> None:
    """A hole in the buffer itself must not be replayed into the book."""

    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100), snapshot(100), snapshot(340))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())

        # 101-105 then a jump to 200-210: the buffer is holed.
        sync.on_delta(delta(101, 105))
        sync.on_delta(delta(200, 210))
        sync.on_delta(delta(341, 350, bids=(level("100.6", "1.0"),)))

        assert await sync.start() is True
        assert sync.statistics.gaps_detected >= 1
        assert sync.phase is SyncPhase.LIVE
        assert sync.book.sequence == 350

    asyncio.run(scenario())


def test_crossed_book_is_not_tradeable() -> None:
    """A bid above the ask is impossible and means the book is corrupt.

    The engine must refuse to quote from it rather than reporting a negative
    spread that a strategy would read as free money.
    """

    async def scenario() -> None:
        fetcher = SnapshotFetcherStub(snapshot(100))
        sync = OrderBookSynchroniser(EXCHANGE, SYMBOL, fetcher, config=fast_config())
        await sync.start()
        assert sync.is_tradeable is True

        # Bid 105 sits above the resting ask of 101.
        sync.on_delta(delta(101, 101, bids=(level("105", "1.0"),)))

        assert sync.book.health is OrderBookHealth.CROSSED
        assert sync.is_tradeable is False
        assert sync.top() is None

    asyncio.run(scenario())
