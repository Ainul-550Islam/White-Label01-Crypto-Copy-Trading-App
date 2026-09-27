"""Stale market-data detection.

The dangerous failure in market data is not a disconnect — a disconnect is loud
and the reconnect logic handles it. The dangerous failure is a socket that stays
open, answers every heartbeat, and stops delivering data. Everything downstream
looks healthy while the book quietly freezes, and a strategy prices orders
against a snapshot of the past.

This module watches per-stream arrival times and flags that condition. It is
pure: it holds timestamps and answers questions about them, performing no I/O
and owning no timer. The caller (the connection manager's watchdog, or a health
endpoint) supplies ``now`` and reacts to the verdict, which makes every
threshold directly testable.

Thresholds are per channel because the channels have genuinely different
natural rates. A book on a liquid pair updates many times a second, so silence
for two seconds is alarming. A trade stream on an illiquid pair may legitimately
be silent for minutes, and flagging that as a fault would produce noise that
trains operators to ignore the alert.
"""

from __future__ import annotations

from dataclasses import dataclass

from wlct_trading.clock import epoch_micros
from wlct_trading.transport.subscriptions import MarketDataChannel

__all__ = [
    "StalenessThresholds",
    "StreamFreshness",
    "StalenessMonitor",
    "StalenessVerdict",
]

_MILLIS = 1_000


@dataclass(slots=True, frozen=True)
class StalenessThresholds:
    """Per-channel silence tolerated before a stream is called stale.

    Defaults are deliberately conservative for the book (which must be fresh to
    be safe) and lenient for trades (which are legitimately sporadic).
    """

    order_book_millis: int = 5_000
    ticker_millis: int = 10_000
    #: Best bid/ask updates on every book change, so silence here is as
    #: suspicious as silence on the book itself.
    book_ticker_millis: int = 5_000
    trades_millis: int = 60_000
    candles_millis: int = 120_000
    #: Silence across the whole connection, regardless of channel. Catches the
    #: case where every stream stops at once.
    connection_millis: int = 30_000

    def for_channel(self, channel: MarketDataChannel) -> int:
        if channel is MarketDataChannel.ORDER_BOOK:
            return self.order_book_millis
        if channel is MarketDataChannel.TICKER:
            return self.ticker_millis
        if channel is MarketDataChannel.BOOK_TICKER:
            return self.book_ticker_millis
        if channel is MarketDataChannel.TRADES:
            return self.trades_millis
        return self.candles_millis


@dataclass(slots=True)
class StreamFreshness:
    """Arrival bookkeeping for one channel/symbol pair."""

    channel: MarketDataChannel
    symbol: str
    last_message_at: int | None = None
    message_count: int = 0
    #: Sticky until recovery, so a transition can be reported exactly once.
    is_stale: bool = False
    became_stale_at: int | None = None
    stale_episodes: int = 0

    @property
    def key(self) -> tuple[str, str]:
        return (self.channel.value, self.symbol)


@dataclass(slots=True, frozen=True)
class StalenessVerdict:
    """Outcome of one evaluation sweep.

    ``newly_stale`` and ``recovered`` carry only the *transitions*, so the
    caller emits one MarketDataStale event per episode rather than one per
    poll.
    """

    newly_stale: tuple[StreamFreshness, ...] = ()
    recovered: tuple[StreamFreshness, ...] = ()
    still_stale: tuple[StreamFreshness, ...] = ()
    connection_stale: bool = False

    @property
    def has_changes(self) -> bool:
        return bool(self.newly_stale or self.recovered)

    @property
    def any_stale(self) -> bool:
        return bool(self.newly_stale or self.still_stale) or self.connection_stale


class StalenessMonitor:
    """Tracks freshness of every stream on one connection."""

    __slots__ = ("_thresholds", "_streams", "_last_any_message_at")

    def __init__(self, thresholds: StalenessThresholds | None = None) -> None:
        self._thresholds = thresholds or StalenessThresholds()
        self._streams: dict[tuple[str, str], StreamFreshness] = {}
        self._last_any_message_at: int | None = None

    @property
    def thresholds(self) -> StalenessThresholds:
        return self._thresholds

    def track(self, channel: MarketDataChannel, symbol: str) -> StreamFreshness:
        """Begin monitoring a stream. Idempotent."""
        key = (channel.value, symbol)
        freshness = self._streams.get(key)
        if freshness is None:
            freshness = StreamFreshness(channel=channel, symbol=symbol)
            self._streams[key] = freshness
        return freshness

    def untrack(self, channel: MarketDataChannel, symbol: str) -> None:
        self._streams.pop((channel.value, symbol), None)

    def record_message(
        self,
        channel: MarketDataChannel,
        symbol: str,
        *,
        at_micros: int | None = None,
    ) -> StreamFreshness:
        """Note that a message arrived. Called on the hot path — keep it cheap."""
        now = epoch_micros() if at_micros is None else at_micros
        freshness = self.track(channel, symbol)
        freshness.last_message_at = now
        freshness.message_count += 1
        self._last_any_message_at = now
        return freshness

    def evaluate(self, *, now_micros: int | None = None) -> StalenessVerdict:
        """Classify every tracked stream as fresh, newly stale, or recovered.

        A stream that has never received a message is *not* reported stale: it
        has not started yet, and conflating "not started" with "stopped" would
        fire an alert on every startup.
        """
        now = epoch_micros() if now_micros is None else now_micros
        newly_stale: list[StreamFreshness] = []
        recovered: list[StreamFreshness] = []
        still_stale: list[StreamFreshness] = []

        for freshness in self._streams.values():
            if freshness.last_message_at is None:
                continue

            limit_micros = (
                self._thresholds.for_channel(freshness.channel) * _MILLIS
            )
            age = now - freshness.last_message_at
            stale_now = age > limit_micros

            if stale_now and not freshness.is_stale:
                freshness.is_stale = True
                freshness.became_stale_at = now
                freshness.stale_episodes += 1
                newly_stale.append(freshness)
            elif stale_now:
                still_stale.append(freshness)
            elif freshness.is_stale:
                freshness.is_stale = False
                freshness.became_stale_at = None
                recovered.append(freshness)

        connection_stale = False
        if self._last_any_message_at is not None:
            connection_age = now - self._last_any_message_at
            connection_stale = (
                connection_age > self._thresholds.connection_millis * _MILLIS
            )

        return StalenessVerdict(
            newly_stale=tuple(newly_stale),
            recovered=tuple(recovered),
            still_stale=tuple(still_stale),
            connection_stale=connection_stale,
        )

    def is_stale(self, channel: MarketDataChannel, symbol: str) -> bool:
        """Last known verdict for one stream, without re-evaluating."""
        freshness = self._streams.get((channel.value, symbol))
        return bool(freshness and freshness.is_stale)

    def any_stale(self) -> bool:
        return any(f.is_stale for f in self._streams.values())

    def stale_streams(self) -> tuple[StreamFreshness, ...]:
        return tuple(f for f in self._streams.values() if f.is_stale)

    def reset(self) -> None:
        """Clear all freshness state, e.g. after a reconnect.

        Arrival times from the previous socket say nothing about the new one,
        and keeping them would make a fresh connection look instantly stale.
        """
        for freshness in self._streams.values():
            freshness.last_message_at = None
            freshness.is_stale = False
            freshness.became_stale_at = None
        self._last_any_message_at = None

    def snapshot(self) -> tuple[StreamFreshness, ...]:
        return tuple(self._streams.values())
