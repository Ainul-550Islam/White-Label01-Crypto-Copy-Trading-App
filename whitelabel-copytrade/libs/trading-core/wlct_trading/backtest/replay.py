"""Deterministic historical replay with a structural no-look-ahead guarantee.

The engine walks a :class:`~wlct_trading.backtest.dataset.HistoricalDataset` in
total order, advancing a :class:`~wlct_trading.backtest.clock.SimulatedClock`
to each event's timestamp before handing the event to the consumer.

**No look-ahead is enforced by construction, not by discipline.** The consumer
is handed one event at a time and a :class:`ReplayCursor` that can only see
what has already been replayed. There is no method anywhere on the cursor that
returns a future event, and :meth:`ReplayCursor.history` is filtered against
the clock, so even a consumer holding a reference to the engine cannot read
ahead. The remaining events live in a private tuple with a private index.

Determinism comes from three properties:

* the dataset is pre-sorted by ``(timestamp, kind rank, sequence)``;
* the clock is the only source of time and is driven by the events;
* nothing in the loop consults a random number generator, a wall clock, a
  network or a filesystem.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterator

from wlct_trading.backtest.clock import SimulatedClock
from wlct_trading.backtest.dataset import HistoricalDataset, MarketEvent
from wlct_trading.enums import MarketEventKind

__all__ = ["ReplayCursor", "ReplayEngine", "LookAheadError", "ReplayStats"]


class LookAheadError(RuntimeError):
    """Raised when something asks for data the replay has not reached."""


@dataclass(slots=True, frozen=True)
class ReplayStats:
    """What a completed replay did."""

    events_replayed: int
    timer_ticks: int
    first_timestamp_micros: int | None
    last_timestamp_micros: int | None

    def to_dict(self) -> dict[str, object]:
        return {
            "eventsReplayed": self.events_replayed,
            "timerTicks": self.timer_ticks,
            "firstTimestampMicros": self.first_timestamp_micros,
            "lastTimestampMicros": self.last_timestamp_micros,
        }


class ReplayCursor:
    """The past-only view a consumer is allowed to hold.

    Everything here is bounded by the clock. ``history`` returns events already
    replayed, and it filters on the clock rather than on an internal index, so
    it stays correct even if a caller keeps the cursor after the replay has
    finished.
    """

    __slots__ = ("_clock", "_seen", "_history_limit")

    def __init__(self, clock: SimulatedClock, *, history_limit: int = 1_000) -> None:
        if history_limit < 0:
            raise ValueError("history_limit must not be negative.")
        self._clock = clock
        self._seen: list[MarketEvent] = []
        self._history_limit = history_limit

    def _record(self, event: MarketEvent) -> None:
        self._seen.append(event)
        if self._history_limit and len(self._seen) > self._history_limit:
            # Bounded memory: a replay of ten million events must not retain
            # ten million objects just so a consumer *could* look back.
            del self._seen[0 : len(self._seen) - self._history_limit]

    @property
    def now_micros(self) -> int:
        return self._clock.now_micros()

    @property
    def observed_count(self) -> int:
        return len(self._seen)

    def latest(self, kind: MarketEventKind | None = None) -> MarketEvent | None:
        """Most recent event at or before now, optionally filtered by kind."""
        now = self._clock.now_micros()
        for event in reversed(self._seen):
            if event.timestamp_micros > now:
                continue
            if kind is None or event.kind is kind:
                return event
        return None

    def history(self, *, kind: MarketEventKind | None = None) -> tuple[MarketEvent, ...]:
        """Every retained event at or before now.

        The clock filter is the guard: an event cannot appear here before the
        replay has advanced to it, so no consumer can see the future through
        this method.
        """
        now = self._clock.now_micros()
        return tuple(
            event
            for event in self._seen
            if event.timestamp_micros <= now
            and (kind is None or event.kind is kind)
        )

    def assert_not_future(self, timestamp_micros: int) -> None:
        """Raise if ``timestamp_micros`` is beyond the replay's current instant."""
        now = self._clock.now_micros()
        if timestamp_micros > now:
            raise LookAheadError(
                f"Attempted to read data at {timestamp_micros} while the replay "
                f"clock stands at {now}. Look-ahead is not permitted."
            )


class ReplayEngine:
    """Walks a dataset in order, driving the clock and a consumer callback."""

    __slots__ = (
        "_dataset",
        "_clock",
        "_cursor",
        "_index",
        "_timer_interval_micros",
        "_next_timer_micros",
        "_timer_ticks",
        "_finished",
    )

    def __init__(
        self,
        dataset: HistoricalDataset,
        *,
        clock: SimulatedClock | None = None,
        timer_interval_micros: int | None = None,
        history_limit: int = 1_000,
    ) -> None:
        if len(dataset) == 0:
            raise ValueError("ReplayEngine requires a non-empty dataset.")
        if timer_interval_micros is not None and timer_interval_micros <= 0:
            raise ValueError("timer_interval_micros must be positive when set.")

        self._dataset = dataset
        start = dataset.events[0].timestamp_micros
        self._clock = clock or SimulatedClock(start_micros=start)
        if self._clock.now_micros() > start:
            raise ValueError(
                "The supplied clock is already past the dataset's first event; "
                "reset it before replaying."
            )
        self._cursor = ReplayCursor(self._clock, history_limit=history_limit)
        self._index = 0
        self._timer_interval_micros = timer_interval_micros
        self._next_timer_micros = (
            start + timer_interval_micros if timer_interval_micros else None
        )
        self._timer_ticks = 0
        self._finished = False

    # -- inspection --------------------------------------------------------
    @property
    def dataset(self) -> HistoricalDataset:
        return self._dataset

    @property
    def clock(self) -> SimulatedClock:
        return self._clock

    @property
    def cursor(self) -> ReplayCursor:
        return self._cursor

    @property
    def is_finished(self) -> bool:
        return self._finished

    @property
    def events_replayed(self) -> int:
        return self._index

    @property
    def remaining(self) -> int:
        return len(self._dataset) - self._index

    # -- driving -----------------------------------------------------------
    def events(self) -> Iterator[MarketEvent]:
        """Yield events in order, advancing the clock before each is seen.

        A generator rather than a callback so a caller can interleave its own
        work. The clock is advanced *before* the event is yielded, so a
        consumer reading ``clock.now_micros()`` sees the event's own instant.
        """
        while self._index < len(self._dataset):
            event = self._dataset.events[self._index]
            self._index += 1
            self._clock.advance_to(event.timestamp_micros)
            self._cursor._record(event)
            yield event
        self._finished = True

    def run(
        self,
        *,
        on_event: Callable[[MarketEvent, ReplayCursor], None],
        on_timer: Callable[[int], None] | None = None,
    ) -> ReplayStats:
        """Replay everything, calling ``on_event`` for each event in order.

        When a timer interval is configured, ``on_timer`` fires for every
        interval boundary crossed *before* the event that crossed it, so a
        strategy's timed logic runs at the right simulated instant rather than
        after the fact. Timer ticks never move the clock past the next event.
        """
        first: int | None = None
        last: int | None = None

        for event in self.events():
            if first is None:
                first = event.timestamp_micros
            last = event.timestamp_micros

            if (
                on_timer is not None
                and self._timer_interval_micros is not None
                and self._next_timer_micros is not None
            ):
                while self._next_timer_micros <= event.timestamp_micros:
                    on_timer(self._next_timer_micros)
                    self._timer_ticks += 1
                    self._next_timer_micros += self._timer_interval_micros

            on_event(event, self._cursor)

        return ReplayStats(
            events_replayed=self._index,
            timer_ticks=self._timer_ticks,
            first_timestamp_micros=first,
            last_timestamp_micros=last,
        )

    def reset(self) -> None:
        """Rewind to the beginning so the identical run can be repeated.

        Used by the reproducibility test: two runs from a reset engine over the
        same dataset must produce byte-identical results.
        """
        start = self._dataset.events[0].timestamp_micros
        self._clock.reset(start)
        self._cursor = ReplayCursor(self._clock)
        self._index = 0
        self._timer_ticks = 0
        self._next_timer_micros = (
            start + self._timer_interval_micros if self._timer_interval_micros else None
        )
        self._finished = False
