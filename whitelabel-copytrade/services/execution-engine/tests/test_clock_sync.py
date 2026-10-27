# Responsibility: prove monotonic measurement and that every unsafe signature is refused.
"""Venue clock synchronisation: the arithmetic, and the three refusals.

The class under test decides the timestamp inside a signed order. Every test
below is therefore about one of two things: whether the offset is *correct*
(midpoint correction, median, latency from the monotonic clock), or whether a
request that cannot be proven correct is *refused* rather than guessed.

The fake clock is deliberately split in two. A ``FakeMonotonic`` advances only
when a test says so, and a ``FakeWall`` can jump backwards and forwards
independently. That split is the whole point: if any part of the implementation
measured latency or staleness with the wall clock, the jump tests would fail.
"""

from __future__ import annotations

import pytest

from app.exchanges.clock_sync import (
    ClockSample,
    ClockSkewExceeded,
    ClockSyncError,
    TimestampUnsafe,
    VenueClockSync,
    median_offset,
)


class FakeMonotonic:
    """A monotonic clock that only moves when told to, in nanoseconds."""

    def __init__(self) -> None:
        self.nanos = 1_000_000_000_000

    def __call__(self) -> int:
        return self.nanos

    def advance_millis(self, millis: int) -> None:
        self.nanos += millis * 1_000_000


class FakeWall:
    """A wall clock that can jump in either direction, unlike a real one."""

    def __init__(self, start_millis: int = 1_700_000_000_000) -> None:
        self.millis = start_millis

    def now_millis(self) -> int:
        return self.millis

    def jump_millis(self, delta: int) -> None:
        self.millis += delta


def make_sync(
    venue_offset_millis: int,
    *,
    monotonic: FakeMonotonic,
    wall: FakeWall,
    max_skew_millis: int = 500,
    max_rtt_millis: int = 2000,
    stale_after_seconds: float = 300.0,
    window: int = 5,
    round_trip_millis: int = 40,
) -> VenueClockSync:
    """A sync whose fetcher reports the venue clock at a controlled offset.

    The fetcher advances the monotonic clock by ``round_trip_millis`` so the
    measurement sees exactly the latency the test intends, and reports
    ``wall_now + venue_offset`` so the resulting estimate is predictable to the
    millisecond.
    """

    def fetch() -> int:
        monotonic.advance_millis(round_trip_millis)
        return wall.now_millis() + venue_offset_millis

    return VenueClockSync(
        fetch,
        max_skew_millis=max_skew_millis,
        max_rtt_millis=max_rtt_millis,
        stale_after_seconds=stale_after_seconds,
        window=window,
        monotonic_nanos=monotonic,
        wall_millis=wall.now_millis,
    )


# ---------------------------------------------------------------------------
# The arithmetic
# ---------------------------------------------------------------------------


async def test_offset_is_measured_at_the_round_trip_midpoint() -> None:
    """A 400 ms round trip must not bias the offset by 200 ms.

    The venue's timestamp is produced somewhere inside the round trip. Using the
    send time as the reference charges the whole latency to the offset; using the
    midpoint charges half of it to each direction, which is the best estimate
    available without a second clock.
    """
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(120, monotonic=monotonic, wall=wall, round_trip_millis=400)

    sample = await sync.synchronise()

    assert sample.round_trip_millis == 400
    # venue said wall+120, and it said so 400 ms after we sent; midpoint reference
    # is wall+200, so the offset is -80.
    assert sample.offset_millis == -80
    assert sync.offset_millis == -80


async def test_signed_timestamp_is_the_local_clock_shifted_by_the_measured_offset() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(45, monotonic=monotonic, wall=wall, round_trip_millis=10)
    await sync.synchronise()
    await sync.synchronise()

    now = 1_700_000_100_000
    assert sync.timestamp_millis(now_millis=now) == now + 40


async def test_median_ignores_a_single_outlier_sample() -> None:
    """One latency spike must not stop trading.

    With five samples the median is the third, so a single 150 ms reading among
    otherwise tight ones cannot push the offset past a 100 ms bound. A mean would.
    """
    samples = [
        ClockSample(20, 30, 0, 0),
        ClockSample(22, 31, 0, 0),
        ClockSample(21, 29, 0, 0),
        ClockSample(150, 40, 0, 0),
        ClockSample(19, 33, 0, 0),
    ]
    assert median_offset(samples) == 21


def test_median_of_an_even_count_takes_the_lower_middle() -> None:
    samples = [ClockSample(10, 20, 0, 0), ClockSample(20, 20, 0, 0)]
    assert median_offset(samples) == 15


def test_median_refuses_an_empty_window() -> None:
    with pytest.raises(ValueError):
        median_offset([])


async def test_window_keeps_only_the_newest_samples() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(30, monotonic=monotonic, wall=wall, window=3)
    for _ in range(7):
        await sync.synchronise()

    assert sync.sample_count == 3


# ---------------------------------------------------------------------------
# Monotonic, not wall
# ---------------------------------------------------------------------------


async def test_latency_comes_from_the_monotonic_clock_not_the_wall_clock() -> None:
    """A wall clock that moves during the round trip must not change the latency.

    This is the failure a naive implementation has: it reads ``time.time()``
    before and after the request, the host steps its clock by -2 s in between,
    and the measured round trip is negative - or, if it steps forward, the offset
    is out by the step with nothing in the logs.
    """
    monotonic = FakeMonotonic()
    wall = FakeWall()

    def fetch() -> int:
        monotonic.advance_millis(50)
        wall.jump_millis(-2_000)
        return wall.now_millis() + 60

    sync = VenueClockSync(fetch, monotonic_nanos=monotonic)
    sample = await sync.synchronise()

    assert sample.round_trip_millis == 50
    assert sample.round_trip_millis >= 0


async def test_staleness_is_measured_on_the_monotonic_clock() -> None:
    """A backwards wall jump must not make a fresh sample look ancient, nor vice versa."""
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(10, monotonic=monotonic, wall=wall, stale_after_seconds=60)
    await sync.synchronise()
    await sync.synchronise()

    wall.jump_millis(-86_400_000)  # a day backwards
    assert sync.allows_signed_request() is True

    monotonic.advance_millis(61_000)
    with pytest.raises(ClockSyncError) as caught:
        sync.timestamp_millis()
    assert "old" in str(caught.value)


# ---------------------------------------------------------------------------
# The three refusals
# ---------------------------------------------------------------------------


def test_never_synchronised_refuses_and_does_not_fall_back_to_the_local_clock() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(0, monotonic=monotonic, wall=wall)

    assert sync.offset_millis is None
    assert sync.allows_signed_request() is False
    with pytest.raises(ClockSyncError) as caught:
        sync.timestamp_millis(now_millis=1_700_000_000_000)
    assert "not synchronised" in str(caught.value)


async def test_a_single_sample_is_unsafe_rather_than_trusted() -> None:
    """One measurement cannot tell a stable offset from a latency spike."""
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(100, monotonic=monotonic, wall=wall)
    await sync.synchronise()

    assert sync.offset_millis == 80
    with pytest.raises(TimestampUnsafe):
        sync.timestamp_millis(now_millis=1_700_000_000_000)


async def test_two_samples_are_enough_to_sign() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(100, monotonic=monotonic, wall=wall)
    await sync.synchronise()
    await sync.synchronise()

    assert sync.allows_signed_request() is True
    assert sync.timestamp_millis(now_millis=1_700_000_000_000) == 1_700_000_000_080


async def test_an_offset_beyond_the_bound_is_skew_exceeded() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(5_000, monotonic=monotonic, wall=wall, max_skew_millis=500)
    await sync.synchronise()
    await sync.synchronise()

    with pytest.raises(ClockSkewExceeded) as caught:
        sync.timestamp_millis(now_millis=1_700_000_000_000)
    assert "NTP" in str(caught.value)


async def test_negative_skew_is_refused_as_firmly_as_positive_skew() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(-3_000, monotonic=monotonic, wall=wall, max_skew_millis=500)
    await sync.synchronise()
    await sync.synchronise()

    with pytest.raises(ClockSkewExceeded):
        sync.timestamp_millis()


async def test_a_slow_round_trip_is_rejected_rather_than_averaged_in() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(
        10, monotonic=monotonic, wall=wall, max_rtt_millis=100, round_trip_millis=5_000
    )

    sample = await sync.synchronise()

    assert sample.is_usable is False
    assert sync.sample_count == 0
    assert sync.rejected_sample_count == 1
    assert sync.offset_millis is None
    with pytest.raises(ClockSyncError):
        sync.timestamp_millis()


async def test_a_failing_fetch_is_a_refusal_that_names_the_cause() -> None:
    monotonic = FakeMonotonic()

    def fetch() -> int:
        raise TimeoutError("connection reset by peer")

    sync = VenueClockSync(fetch, monotonic_nanos=monotonic)
    with pytest.raises(ClockSyncError) as caught:
        await sync.synchronise()

    assert "TimeoutError" in str(caught.value)
    assert sync.last_error is not None and "connection reset" in sync.last_error
    assert sync.allows_signed_request() is False


async def test_an_awaitable_fetcher_is_supported() -> None:
    """The transport may be async; the measurement must still be taken around it."""
    monotonic = FakeMonotonic()
    wall = FakeWall()

    async def fetch() -> int:
        monotonic.advance_millis(20)
        return wall.now_millis() + 1_000

    sync = VenueClockSync(
        fetch,
        monotonic_nanos=monotonic,
        wall_millis=wall.now_millis,
    )
    sample = await sync.synchronise()

    assert sample.round_trip_millis == 20
    assert sample.offset_millis == 990


# ---------------------------------------------------------------------------
# Reporting and reset
# ---------------------------------------------------------------------------


async def test_describe_is_secret_free_and_reports_the_gate() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(70, monotonic=monotonic, wall=wall)

    before = sync.describe()
    assert before["signedRequestsAllowed"] is False
    assert before["offsetMillis"] is None

    await sync.synchronise()
    await sync.synchronise()
    after = sync.describe()

    assert after["signedRequestsAllowed"] is True
    assert after["offsetMillis"] == 50
    assert after["samples"] == 2
    assert after["syncCount"] == 2
    # Nothing in the report can be used to rebuild a signature.
    assert set(after) == {
        "samples",
        "rejectedSamples",
        "syncCount",
        "offsetMillis",
        "maxSkewMillis",
        "maxRoundTripMillis",
        "staleAfterSeconds",
        "lastError",
        "signedRequestsAllowed",
    }


async def test_reset_forgets_every_sample_so_signing_stops() -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    sync = make_sync(70, monotonic=monotonic, wall=wall)
    await sync.synchronise()
    await sync.synchronise()
    assert sync.allows_signed_request() is True

    sync.reset()

    assert sync.sample_count == 0
    assert sync.offset_millis is None
    assert sync.allows_signed_request() is False


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"max_skew_millis": 0}, "max_skew_millis"),
        ({"max_rtt_millis": 0}, "max_rtt_millis"),
        ({"stale_after_seconds": 0}, "stale_after_seconds"),
        ({"window": 0}, "window"),
    ],
)
def test_constructor_refuses_a_configuration_that_would_disable_a_gate(
    kwargs: dict[str, object], message: str
) -> None:
    monotonic = FakeMonotonic()
    wall = FakeWall()
    with pytest.raises(ValueError) as caught:
        make_sync(0, monotonic=monotonic, wall=wall, **kwargs)  # type: ignore[arg-type]
    assert message in str(caught.value)
