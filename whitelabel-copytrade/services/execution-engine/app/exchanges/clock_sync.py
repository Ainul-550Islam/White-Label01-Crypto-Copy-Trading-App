# Responsibility: monotonic-clock venue time estimation that refuses to sign without proof.
"""Venue clock synchronisation for the execution engine's live path.

WHY THE ENGINE NEEDS ITS OWN
----------------------------
The API estimates venue offsets for display and for its own signing
(:mod:`apps/api/src/modules/exchanges/venue-clock.service.ts`). The engine cannot
borrow that estimate: it signs the requests that place orders, and it runs in a
different process with a different host clock. A venue rejects a request whose
timestamp is outside ``recvWindow``, and the failure looks like an auth error,
which sends an operator to rotate a key that was never wrong.

WHAT MAKES THIS DIFFERENT FROM A WALL-CLOCK OFFSET
--------------------------------------------------
Round-trip latency is measured with :func:`time.monotonic_ns`, never with the
wall clock. A wall clock can jump between two reads - NTP, a VM pause, a
container migration - and a jump inside the measurement produces an offset that
is wrong by exactly the jump, with no error anywhere. Monotonic time cannot jump,
so the *latency* half of the estimate is trustworthy even when the wall clock is
not.

The estimate itself is ``venue_time - (wall_at_send + rtt / 2)``: the venue's
timestamp corresponds to the midpoint of the round trip, not to either end.
Using the send time biases the offset by half the latency, which on a slow link
is hundreds of milliseconds - half the rejection budget spent on a rounding
choice.

THE THREE REFUSALS
------------------
``ClockSyncError``          no usable measurement (never measured, all samples
                            rejected, or the last sample older than the bound).
``ClockSkewExceeded``       a measurement exists and is outside the tolerated
                            offset, so a signature built from it would be
                            refused by the venue anyway.
``TimestampUnsafe``         the offset is within the tolerance but the *evidence*
                            is not: fewer than the required samples, or a sample
                            whose round trip was too slow to be meaningful.

All three refuse. There is no "proceed with a warning" path because the only
thing a wrong timestamp buys is a rejected order at best, and an order accepted
at a moment nobody intended at worst.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Final

__all__ = [
    "ClockSyncError",
    "ClockSkewExceeded",
    "TimestampUnsafe",
    "ClockSample",
    "VenueClockSync",
    "DEFAULT_WINDOW",
    "DEFAULT_MAX_RTT_MILLIS",
    "DEFAULT_MAX_SKEW_MILLIS",
    "DEFAULT_STALE_AFTER_SECONDS",
]

#: Samples kept for the median. Five is the smallest window where a single
#: outlier cannot move the median, and small enough to fill within one sync burst.
DEFAULT_WINDOW: Final[int] = 5
#: A round trip slower than this tells us more about the network's queue than
#: about the venue's clock, so the sample is discarded rather than averaged in.
DEFAULT_MAX_RTT_MILLIS: Final[int] = 2_000
#: Binance rejects a request more than 1 000 ms ahead of server time regardless
#: of ``recvWindow``; 500 ms leaves room for the order queue before signing.
DEFAULT_MAX_SKEW_MILLIS: Final[int] = 500
#: Past this age the offset may have changed under us (the host clock stepped,
#: the venue's did). Five minutes matches the API's bound.
DEFAULT_STALE_AFTER_SECONDS: Final[float] = 300.0

ServerTimeFetcher = Callable[[], "int | Awaitable[int]"]
MonotonicNanos = Callable[[], int]
WallMillis = Callable[[], int]


class ClockSyncError(RuntimeError):
    """No usable measurement exists, so no timestamp can be produced."""


class ClockSkewExceeded(ClockSyncError):
    """The measured offset is outside the tolerated bound."""


class TimestampUnsafe(ClockSyncError):
    """The offset is plausible but the evidence behind it is not good enough."""


@dataclass(frozen=True, slots=True)
class ClockSample:
    """One measurement: what we think the venue's clock reads, and how sure we are."""

    offset_millis: int
    round_trip_millis: int
    #: Monotonic nanoseconds at the moment the request was sent. Monotonic because
    #: this is what the staleness check compares against.
    measured_at_monotonic_nanos: int
    #: Wall-clock milliseconds at the moment the request was sent, kept for
    #: reporting only. Never used in arithmetic that decides a signature.
    wall_at_send_millis: int

    @property
    def is_usable(self) -> bool:
        """A sample with no positive round trip is a clock read, not a measurement."""
        return 0 <= self.round_trip_millis <= DEFAULT_MAX_RTT_MILLIS


class VenueClockSync:
    """Collects samples and answers two questions: what time is it at the venue, and may I sign?

    Usage is two calls, in this order and no other: :meth:`synchronise` from a
    background task, :meth:`timestamp_millis` immediately before signing. The
    second raises when the first has not produced a usable, recent measurement.
    """

    __slots__ = (
        "_fetch_server_time",
        "_monotonic_nanos",
        "_wall_millis",
        "_max_skew_millis",
        "_max_rtt_millis",
        "_stale_after_seconds",
        "_window",
        "_samples",
        "_rejected_samples",
        "_last_error",
        "_sync_count",
    )

    def __init__(
        self,
        fetch_server_time: ServerTimeFetcher,
        *,
        max_skew_millis: int = DEFAULT_MAX_SKEW_MILLIS,
        max_rtt_millis: int = DEFAULT_MAX_RTT_MILLIS,
        stale_after_seconds: float = DEFAULT_STALE_AFTER_SECONDS,
        window: int = DEFAULT_WINDOW,
        monotonic_nanos: MonotonicNanos | None = None,
        wall_millis: WallMillis | None = None,
    ) -> None:
        if max_skew_millis <= 0:
            raise ValueError("max_skew_millis must be positive; a zero bound refuses every order")
        if max_rtt_millis <= 0:
            raise ValueError("max_rtt_millis must be positive")
        if stale_after_seconds <= 0:
            raise ValueError("stale_after_seconds must be positive")
        if window < 1:
            raise ValueError("window must be at least 1 sample")
        self._fetch_server_time = fetch_server_time
        self._monotonic_nanos = monotonic_nanos or time.monotonic_ns
        self._wall_millis = wall_millis or _system_wall_millis
        self._max_skew_millis = max_skew_millis
        self._max_rtt_millis = max_rtt_millis
        self._stale_after_seconds = stale_after_seconds
        self._window = window
        self._samples: list[ClockSample] = []
        self._rejected_samples = 0
        self._last_error: str | None = None
        self._sync_count = 0

    # ------------------------------------------------------------------
    # Measurement
    # ------------------------------------------------------------------
    async def synchronise(self) -> ClockSample:
        """Take one measurement. Raises only when the fetch itself fails.

        A slow sample is *recorded* but marked unusable: the next sync may be
        fast, and throwing the measurement away here would leave the caller
        unable to tell "the network is slow" from "the venue is unreachable".
        """
        started = self._monotonic_nanos()
        wall_at_send = self._wall_millis()
        try:
            venue_millis = await _resolve_server_time(self._fetch_server_time())
        except Exception as exc:  # noqa: BLE001 - normalised into one error type
            self._last_error = f"{type(exc).__name__}: {exc}"
            raise ClockSyncError(
                f"Could not read the venue's clock ({self._last_error}). The engine will not "
                "sign a request without a measurement, because a request with a guessed "
                "timestamp is refused by the venue at best."
            ) from exc
        elapsed_nanos = self._monotonic_nanos() - started
        round_trip_millis = max(0, elapsed_nanos // 1_000_000)

        sample = ClockSample(
            # The venue's timestamp belongs to the MIDDLE of the round trip.
            offset_millis=int(venue_millis - (wall_at_send + round_trip_millis // 2)),
            round_trip_millis=round_trip_millis,
            measured_at_monotonic_nanos=started,
            wall_at_send_millis=wall_at_send,
        )
        self._sync_count += 1
        if not sample.is_usable:
            self._rejected_samples += 1
            self._last_error = (
                f"round trip {round_trip_millis} ms exceeds the {self._max_rtt_millis} ms "
                "bound; the sample says more about the network queue than about the clock"
            )
            return sample

        self._samples.append(sample)
        del self._samples[: max(0, len(self._samples) - self._window)]
        self._last_error = None
        return sample

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------
    @property
    def offset_millis(self) -> int | None:
        """The median offset of the current window, or ``None`` with no samples."""
        usable = [sample for sample in self._samples if sample.is_usable]
        if not usable:
            return None
        return median_offset(usable)

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def sample_count(self) -> int:
        return len(self._samples)

    @property
    def rejected_sample_count(self) -> int:
        return self._rejected_samples

    def describe(self) -> dict[str, object]:
        """A secret-free view for /status and for the startup log."""
        return {
            "samples": len(self._samples),
            "rejectedSamples": self._rejected_samples,
            "syncCount": self._sync_count,
            "offsetMillis": self.offset_millis,
            "maxSkewMillis": self._max_skew_millis,
            "maxRoundTripMillis": self._max_rtt_millis,
            "staleAfterSeconds": self._stale_after_seconds,
            "lastError": self._last_error,
            "signedRequestsAllowed": self._refusal() is None,
        }

    def timestamp_millis(self, *, now_millis: int | None = None) -> int:
        """The venue-aligned timestamp to sign with, or a refusal.

        Every branch below is a refusal rather than a fallback. In particular the
        "not synced" case does NOT return the local clock: a deployment that
        cannot measure the venue's clock has no business placing an order, and
        pretending otherwise moves the failure to the venue where it is harder to
        read.
        """
        refusal = self._refusal()
        if refusal is not None:
            raise refusal
        offset = self.offset_millis
        assert offset is not None  # _refusal() above proved it
        now = self._wall_millis() if now_millis is None else now_millis
        return now + offset

    def allows_signed_request(self) -> bool:
        """Whether a signed request may be built right now."""
        return self._refusal() is None

    def reset(self) -> None:
        """Forget every sample. For an operator who has just fixed the host clock."""
        self._samples.clear()
        self._rejected_samples = 0
        self._last_error = None
        self._sync_count = 0

    def _refusal(self) -> ClockSyncError | None:
        """The reason signing is refused, or ``None`` when it may proceed."""
        usable = [sample for sample in self._samples if sample.is_usable]
        if not usable:
            return ClockSyncError(
                "No usable venue clock sample: the engine has not synchronised, or every "
                "sample was rejected as too slow. Signing is refused."
            )
        newest = max(sample.measured_at_monotonic_nanos for sample in usable)
        age_seconds = (self._monotonic_nanos() - newest) / 1_000_000_000
        if age_seconds > self._stale_after_seconds:
            return ClockSyncError(
                f"The newest venue clock sample is {age_seconds:.0f}s old, beyond the "
                f"{self._stale_after_seconds:.0f}s bound. Signing is refused until it "
                "synchronises again."
            )
        offset = median_offset(usable)
        if abs(offset) > self._max_skew_millis:
            return ClockSkewExceeded(
                f"The venue clock is offset by {offset} ms, beyond the "
                f"{self._max_skew_millis} ms bound. Signing would be refused by the venue; "
                "fix the host clock (NTP) before trading."
            )
        if len(usable) < min(2, self._window):
            return TimestampUnsafe(
                "A single clock sample is not enough to sign with: one measurement cannot "
                "distinguish a stable offset from a latency spike. Sync again."
            )
        return None


def _system_wall_millis() -> int:
    """The host wall clock in milliseconds. The only place the module reads it."""
    return int(time.time() * 1_000)


def median_offset(samples: Sequence[ClockSample]) -> int:
    """Median of the sample offsets, lower middle for an even count.

    The median rather than the mean because one slow sample among five can move a
    mean past the skew bound and stop trading for a reason that was measured once.
    """
    if not samples:
        raise ValueError("median_offset needs at least one sample")
    offsets = sorted(sample.offset_millis for sample in samples)
    middle = len(offsets) // 2
    if len(offsets) % 2 == 1:
        return int(offsets[middle])
    return int((offsets[middle - 1] + offsets[middle]) // 2)


async def _resolve_server_time(value: int | Awaitable[int]) -> int:
    """Accept a plain int or an awaitable returning one.

    The engine's HTTP client may be synchronous or asynchronous depending on the
    transport; allowing both here keeps one class instead of two near-identical
    ones, and the timing still starts before the call in either shape.
    """
    if isinstance(value, int):
        return value
    return int(await value)
