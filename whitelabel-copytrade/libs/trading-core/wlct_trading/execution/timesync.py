"""Exchange clock synchronisation and timestamp-skew enforcement.

Authenticated venues reject a request whose timestamp is outside their accepted
window, and the local clock is not trustworthy: containers drift, VMs pause,
and NTP steps happen mid-flight. A trading process that assumes its own clock is
correct discovers otherwise as a burst of ``-1021 Timestamp for this request was
outside of the recvWindow`` rejections during exactly the volatility that made
the orders urgent.

The model here is deliberately conservative:

* The offset is measured, not assumed, from the venue's own ``serverTime``.
* Round-trip time is halved and subtracted, the standard estimator, and the
  measurement's uncertainty is retained rather than discarded.
* A sample taken over a long round trip is *less* trustworthy, so the estimator
  keeps the best (lowest-RTT) recent sample rather than a plain average.
* If the offset is unknown or the last sync is too old, signing is **refused**.
  A rejected order is recoverable; an order stamped with a wrong time may be
  rejected, may be accepted late, and is not.

Nothing here silently corrects a clock. It reports, and it refuses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from wlct_trading.clock import epoch_micros, monotonic_nanos

__all__ = [
    "ClockSyncError",
    "ClockSkewExceeded",
    "ClockNotSynchronised",
    "TimeSample",
    "ClockSyncStatus",
    "ExchangeClock",
    "ServerTimeFetcher",
]

#: Returns the venue's current server time in **milliseconds**.
ServerTimeFetcher = Callable[[], Awaitable[int]]


class ClockSyncError(Exception):
    """Base class for clock synchronisation failures."""


class ClockNotSynchronised(ClockSyncError):
    """No usable measurement of the venue's clock is available.

    Signing is refused in this state. It is reachable at startup before the
    first sync, and after a sync has been stale for too long.
    """


class ClockSkewExceeded(ClockSyncError):
    """The measured offset is larger than the configured safe limit.

    This means the local clock is genuinely wrong, not that the venue is slow.
    Fixing it is an operations task (NTP), so the platform surfaces it rather
    than compensating for an arbitrarily large error.
    """

    def __init__(self, offset_millis: int, limit_millis: int) -> None:
        self.offset_millis = offset_millis
        self.limit_millis = limit_millis
        super().__init__(
            f"Local clock differs from the exchange by {offset_millis}ms, which "
            f"exceeds the safe limit of {limit_millis}ms. Authenticated requests "
            f"are refused until the host clock is corrected (check NTP)."
        )


@dataclass(frozen=True, slots=True)
class TimeSample:
    """One measurement of the venue's clock against ours."""

    #: Venue time minus local time, in milliseconds. Positive means we are behind.
    offset_millis: int
    #: Round-trip time of the measuring request, in milliseconds.
    round_trip_millis: int
    #: Local wall-clock micros when the sample was taken.
    measured_at_micros: int

    @property
    def uncertainty_millis(self) -> int:
        """Half the round trip: the most the offset could be wrong by.

        The venue's timestamp was generated somewhere inside the round trip, so
        the true offset lies within +/- rtt/2 of the estimate.
        """
        return self.round_trip_millis // 2


@dataclass(frozen=True, slots=True)
class ClockSyncStatus:
    """Everything an operator needs to judge clock health."""

    synchronised: bool
    offset_millis: int | None
    uncertainty_millis: int | None
    last_sync_at_micros: int | None
    age_millis: int | None
    sample_count: int
    consecutive_failures: int
    last_error: str | None
    within_limits: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "synchronised": self.synchronised,
            "offsetMillis": self.offset_millis,
            "uncertaintyMillis": self.uncertainty_millis,
            "lastSyncAtMicros": self.last_sync_at_micros,
            "ageMillis": self.age_millis,
            "sampleCount": self.sample_count,
            "consecutiveFailures": self.consecutive_failures,
            "lastError": self.last_error,
            "withinLimits": self.within_limits,
        }


class ExchangeClock:
    """Tracks the offset between the local clock and one venue's clock.

    Usage is two calls: :meth:`synchronise` periodically from a background task,
    and :meth:`timestamp_millis` immediately before signing. The second raises
    if the first has not produced a usable, recent measurement.
    """

    __slots__ = (
        "_fetch",
        "_max_skew_millis",
        "_max_age_micros",
        "_max_round_trip_millis",
        "_best_sample",
        "_samples",
        "_consecutive_failures",
        "_last_error",
        "_sample_count",
        "_require_sync",
    )

    def __init__(
        self,
        fetch_server_time: ServerTimeFetcher,
        *,
        max_skew_millis: int = 1_000,
        max_age_seconds: int = 300,
        max_round_trip_millis: int = 5_000,
        require_sync: bool = True,
    ) -> None:
        """
        ``max_skew_millis`` defaults to 1000: Binance rejects a request whose
        timestamp is more than 1000 ms ahead of server time outright, regardless
        of ``recvWindow``, so a larger local error cannot be compensated for by
        widening the window.

        ``require_sync`` exists only for the paper and dry-run paths, where no
        request is transmitted and refusing to produce a timestamp would block
        an otherwise safe simulation. It must never be false on a live path.
        """
        if max_skew_millis <= 0:
            raise ValueError("max_skew_millis must be positive.")
        if max_age_seconds <= 0:
            raise ValueError("max_age_seconds must be positive.")
        self._fetch = fetch_server_time
        self._max_skew_millis = max_skew_millis
        self._max_age_micros = max_age_seconds * 1_000_000
        self._max_round_trip_millis = max_round_trip_millis
        self._best_sample: TimeSample | None = None
        self._samples: list[TimeSample] = []
        self._consecutive_failures = 0
        self._last_error: str | None = None
        self._sample_count = 0
        self._require_sync = require_sync

    # ------------------------------------------------------------------
    # Measurement
    # ------------------------------------------------------------------
    async def synchronise(self) -> TimeSample:
        """Take one measurement of the venue's clock.

        Raises :class:`ClockSyncError` on failure; the previous sample is kept
        so a single failed probe does not immediately disable trading.
        """
        started_nanos = monotonic_nanos()
        local_before_micros = epoch_micros()
        try:
            server_millis = await self._fetch()
        except Exception as exc:  # noqa: BLE001 - normalised below
            self._consecutive_failures += 1
            self._last_error = f"{type(exc).__name__}: {exc}"
            raise ClockSyncError(
                f"Could not read exchange server time: {type(exc).__name__}."
            ) from exc

        round_trip_nanos = monotonic_nanos() - started_nanos
        round_trip_millis = max(0, round_trip_nanos // 1_000_000)

        if round_trip_millis > self._max_round_trip_millis:
            self._consecutive_failures += 1
            self._last_error = (
                f"Discarded a clock sample with a {round_trip_millis}ms round trip."
            )
            raise ClockSyncError(
                f"Clock sample round trip was {round_trip_millis}ms, above the "
                f"{self._max_round_trip_millis}ms limit; the measurement is too "
                f"imprecise to trust."
            )

        # Estimate local time at the instant the venue stamped its reply: the
        # midpoint of the round trip.
        local_midpoint_millis = (
            local_before_micros // 1_000 + round_trip_millis // 2
        )
        sample = TimeSample(
            offset_millis=int(server_millis) - int(local_midpoint_millis),
            round_trip_millis=int(round_trip_millis),
            measured_at_micros=epoch_micros(),
        )

        self._consecutive_failures = 0
        self._last_error = None
        self._sample_count += 1
        self._record(sample)
        return sample

    def _record(self, sample: TimeSample) -> None:
        """Keep the most trustworthy recent sample.

        Lowest round trip wins, because a fast reply brackets the venue's clock
        more tightly. A stale best sample is displaced by any fresh one so a
        single lucky measurement cannot pin the estimate forever.
        """
        self._samples.append(sample)
        if len(self._samples) > 16:
            self._samples.pop(0)

        recent = [
            candidate
            for candidate in self._samples
            if sample.measured_at_micros - candidate.measured_at_micros
            <= self._max_age_micros
        ]
        self._best_sample = min(
            recent or [sample], key=lambda item: item.round_trip_millis
        )

    # ------------------------------------------------------------------
    # Use
    # ------------------------------------------------------------------
    @property
    def offset_millis(self) -> int | None:
        return self._best_sample.offset_millis if self._best_sample else None

    @property
    def is_synchronised(self) -> bool:
        sample = self._best_sample
        if sample is None:
            return False
        return (epoch_micros() - sample.measured_at_micros) < self._max_age_micros

    @property
    def is_within_limits(self) -> bool:
        offset = self.offset_millis
        if offset is None:
            return False
        return abs(offset) <= self._max_skew_millis

    def timestamp_millis(self, *, now_micros: int | None = None) -> int:
        """Venue-aligned millisecond timestamp for signing.

        Raises :class:`ClockNotSynchronised` if no recent measurement exists and
        :class:`ClockSkewExceeded` if the host clock is too far out. Both are
        refusals, not warnings: an order signed with a bad timestamp is either
        rejected or — worse — accepted at a moment nobody intended.
        """
        now = epoch_micros() if now_micros is None else now_micros
        sample = self._best_sample

        if sample is None or (now - sample.measured_at_micros) >= self._max_age_micros:
            if not self._require_sync:
                return now // 1_000
            age = (
                "never synchronised"
                if sample is None
                else f"last synchronised {(now - sample.measured_at_micros) // 1000}ms ago"
            )
            raise ClockNotSynchronised(
                f"Refusing to sign an exchange request: the exchange clock is "
                f"{age}, so the timestamp cannot be trusted. "
                f"{self._failure_hint()}"
            )

        if abs(sample.offset_millis) > self._max_skew_millis:
            raise ClockSkewExceeded(sample.offset_millis, self._max_skew_millis)

        return (now // 1_000) + sample.offset_millis

    def _failure_hint(self) -> str:
        if self._last_error:
            return f"Last synchronisation attempt failed with: {self._last_error}"
        return "No synchronisation attempt has completed yet."

    def status(self, *, now_micros: int | None = None) -> ClockSyncStatus:
        now = epoch_micros() if now_micros is None else now_micros
        sample = self._best_sample
        age_millis = (
            (now - sample.measured_at_micros) // 1_000 if sample is not None else None
        )
        return ClockSyncStatus(
            synchronised=self.is_synchronised,
            offset_millis=sample.offset_millis if sample else None,
            uncertainty_millis=sample.uncertainty_millis if sample else None,
            last_sync_at_micros=sample.measured_at_micros if sample else None,
            age_millis=age_millis,
            sample_count=self._sample_count,
            consecutive_failures=self._consecutive_failures,
            last_error=self._last_error,
            within_limits=self.is_within_limits,
        )

    def reset(self) -> None:
        self._best_sample = None
        self._samples.clear()
        self._consecutive_failures = 0
        self._last_error = None
        self._sample_count = 0

    def seed(self, offset_millis: int, *, round_trip_millis: int = 0) -> TimeSample:
        """Inject a measurement directly.

        For tests and for a process that inherits a measured offset from a
        sibling. Not a way to bypass synchronisation on a live path — the skew
        limit still applies at :meth:`timestamp_millis`.
        """
        sample = TimeSample(
            offset_millis=offset_millis,
            round_trip_millis=round_trip_millis,
            measured_at_micros=epoch_micros(),
        )
        self._sample_count += 1
        self._record(sample)
        return sample
