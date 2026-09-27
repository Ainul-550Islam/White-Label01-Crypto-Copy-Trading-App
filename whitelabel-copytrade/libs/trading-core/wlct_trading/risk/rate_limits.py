"""Order- and cancel-rate accounting.

The gate's own rule evaluation reads counts from the risk snapshot — pure,
in-memory, deterministic. This module is the machinery that makes those
numbers *true across instances*: a fixed-bucket Redis counter that two
workers share, incremented atomically at decision time.

Why fixed buckets instead of a sliding log: a per-second decision budget of
"a few" orders does not need millisecond window precision, it needs the
property that the number two independent workers both observed is the number
that was actually incremented — which a pipeline of ``INCR`` plus
``EXPIRE`` in one Lua script gives, and a client-side sliding window over
private logs gives only per process. The 1-second/60-second buckets mirror
exactly the two windows the configuration language admits
(``RATE_WINDOW_ONE_SECOND_MICROS``/``RATE_WINDOW_ONE_MINUTE_MICROS``), so
there is no window a counter can answer for that a rule cannot consume.

Honesty about the model: the counter is consumed *before* submission and
rolled back if the order is rejected before leaving the process. Between
the increment and a crash, a slot can be lost until the bucket expires — a
fail-closed error direction by design (a lost slot blocks one extra order
for at most a second; an uncounted order is the incident).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Protocol

from wlct_trading.redis_keys import RedisKeys

__all__ = [
    "RiskRateKind",
    "RiskRateState",
    "RateWindowCounters",
    "RateCoordinator",
    "RateReservation",
    "LocalRateCoordinator",
    "RATE_COUNTER_SCRIPT",
    "RATE_ROLLBACK_SCRIPT",
    "RATE_BUCKET_ONE_SECOND_MICROS",
    "RATE_BUCKET_ONE_MINUTE_MICROS",
]

RATE_BUCKET_ONE_SECOND_MICROS: Final[int] = 1_000_000
RATE_BUCKET_ONE_MINUTE_MICROS: Final[int] = 60_000_000


class RiskRateKind:
    """Which activity a counter tracks. Both strings are wire values."""

    ORDERS: Final[str] = "order"
    CANCELS: Final[str] = "cancel"


@dataclass(slots=True, frozen=True)
class RiskRateState:
    """Rate counts *as carried by a risk snapshot*.

    Each field is ``None`` when the source that measures it was unavailable
    — ``0`` is a measurement of zero activity, and collapsing the two would
    let a Redis outage look like a quiet strategy, which is the difference
    between "no data" and "safe" that this whole engine is about.
    """

    #: When the counts were measured; ages with the snapshot.
    measured_at_micros: int
    orders_last_second: int | None = None
    orders_last_minute: int | None = None
    cancels_last_second: int | None = None
    cancels_last_minute: int | None = None

    def to_payload(self) -> dict[str, object]:
        return {
            "measuredAtMicros": self.measured_at_micros,
            "ordersLastSecond": self.orders_last_second,
            "ordersLastMinute": self.orders_last_minute,
            "cancelsLastSecond": self.cancels_last_second,
            "cancelsLastMinute": self.cancels_last_minute,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, object]) -> "RiskRateState":
        def optional_int(name: str) -> int | None:
            raw = payload.get(name)
            if raw is None:
                return None
            if not isinstance(raw, int) or isinstance(raw, bool) or raw < 0:
                raise ValueError(f"{name} must be a non-negative integer.")
            return int(raw)

        measured = payload.get("measuredAtMicros")
        if not isinstance(measured, int) or isinstance(measured, bool):
            raise ValueError("measuredAtMicros must be an integer.")
        return cls(
            measured_at_micros=measured,
            orders_last_second=optional_int("ordersLastSecond"),
            orders_last_minute=optional_int("ordersLastMinute"),
            cancels_last_second=optional_int("cancelsLastSecond"),
            cancels_last_minute=optional_int("cancelsLastMinute"),
        )


@dataclass(slots=True, frozen=True)
class RateWindowCounters:
    """The four counters a snapshot's rate section must expose, together.

    Named tuple-of-optional-ints would be correct but unreadable at the call
    site; this small type exists so ``rules`` can pull a bucket by
    (kind, window) without a dozen ``getattr`` strings.
    """

    orders_per_second: int | None
    orders_per_minute: int | None
    cancels_per_second: int | None
    cancels_per_minute: int | None

    @classmethod
    def from_state(cls, state: RiskRateState | None) -> "RateWindowCounters":
        if state is None:
            return cls(None, None, None, None)
        return cls(
            orders_per_second=state.orders_last_second,
            orders_per_minute=state.orders_last_minute,
            cancels_per_second=state.cancels_last_second,
            cancels_per_minute=state.cancels_last_minute,
        )

    def bucket_for(
        self, kind: str, window_micros: int
    ) -> tuple[int | None, bool]:
        """Return ``(count, known)`` for a (kind, window) pair.

        A window the snapshot cannot answer for is ``known=False`` — the
        caller refuses rather than substituting zero. Only the two fixed
        windows are legal by configuration; anything else reaching here is a
        bug upstream and is reported as unverifiable rather than guessed.
        """
        # if/elif rather than match: bare names in match *patterns* bind, so
        # module-level constants cannot be value patterns without a dotted
        # owner, and an if/elif chain over two kinds and two windows is the
        # clearest shape that cannot accidentally become a capture.
        if kind == RiskRateKind.ORDERS:
            if window_micros == RATE_BUCKET_ONE_SECOND_MICROS:
                value = self.orders_per_second
            elif window_micros == RATE_BUCKET_ONE_MINUTE_MICROS:
                value = self.orders_per_minute
            else:
                return None, False
        elif kind == RiskRateKind.CANCELS:
            if window_micros == RATE_BUCKET_ONE_SECOND_MICROS:
                value = self.cancels_per_second
            elif window_micros == RATE_BUCKET_ONE_MINUTE_MICROS:
                value = self.cancels_per_minute
            else:
                return None, False
        else:
            return None, False
        return value, value is not None


@dataclass(slots=True, frozen=True)
class RateReservation:
    """Outcome of an atomic consume-one attempt against the shared windows.

    ``granted`` is a decision about *both* windows of the kind: a second
    bucket and a minute bucket must both have room, and the increment
    either lands on both or on neither (the script's guarantee).
    ``rollback`` carries the exact keys/tokens needed to undo the increment
    when the order never reaches the venue.
    """

    granted: bool
    kind: str
    tenant_id: str
    account_id: str
    second_count: int
    minute_count: int
    second_bucket: int
    minute_bucket: int
    #: ``None`` when the reservation could not be attempted (Redis down):
    #: denial is then by the caller's fail-closed policy, not by a count.
    error: str | None = None


class RateCoordinator(Protocol):
    """Consume-one rate check, shared across engine instances."""

    def try_consume(
        self,
        tenant_id: str,
        account_id: str,
        kind: str,
        now_micros: int,
        *,
        max_per_second: int,
        max_per_minute: int,
    ) -> RateReservation:
        """Atomically increment both windows and report whether room existed.

        Synchronous by contract: the hot path must not block on an
        unreachable Redis - a coordinator that cannot answer returns a
        denial (``granted=False`` with ``error`` set), and the gate fails
        closed on that. Implementations MAY complete the call from a
        pre-fetched pipelined result; they MAY NOT treat an error as
        permission.
        """
        ...

    def rollback(self, reservation: RateReservation) -> None:
        """Undo a granted reservation whose order never proceeded."""
        ...


class LocalRateCoordinator:
    """Single-process sliding buckets for tests, paper and backtests.

    Deterministic given the timestamps handed to it — time arrives as an
    argument, never from the wall clock, because a test that sleeps is a
    test that flakes. Satisfies :class:`RateCoordinator` structurally, the
    same way the in-memory lock manager satisfies its protocol.
    """

    __slots__ = ("_orders", "_cancels")

    def __init__(self) -> None:
        self._orders: dict[tuple[str, str, int, int], int] = {}
        self._cancels: dict[tuple[str, str, int, int], int] = {}

    def _store(self, kind: str) -> dict[tuple[str, str, int, int], int]:
        if kind == RiskRateKind.ORDERS:
            return self._orders
        if kind == RiskRateKind.CANCELS:
            return self._cancels
        raise ValueError(f"Unknown rate kind {kind!r}.")

    def observe(self, tenant_id: str, account_id: str, kind: str, now_micros: int) -> None:
        """Count an externally observed event (activity from another worker)."""
        store = self._store(kind)
        for bucket_micros in (
            RATE_BUCKET_ONE_SECOND_MICROS,
            RATE_BUCKET_ONE_MINUTE_MICROS,
        ):
            key = (tenant_id, account_id, bucket_micros, now_micros // bucket_micros)
            store[key] = store.get(key, 0) + 1

    def counts(
        self, tenant_id: str, account_id: str, kind: str, now_micros: int
    ) -> tuple[int, int]:
        store = self._store(kind)
        second = store.get(
            (
                tenant_id,
                account_id,
                RATE_BUCKET_ONE_SECOND_MICROS,
                now_micros // RATE_BUCKET_ONE_SECOND_MICROS,
            ),
            0,
        )
        minute = store.get(
            (
                tenant_id,
                account_id,
                RATE_BUCKET_ONE_MINUTE_MICROS,
                now_micros // RATE_BUCKET_ONE_MINUTE_MICROS,
            ),
            0,
        )
        return second, minute

    def try_consume(
        self,
        tenant_id: str,
        account_id: str,
        kind: str,
        now_micros: int,
        *,
        max_per_second: int,
        max_per_minute: int,
    ) -> RateReservation:
        store = self._store(kind)
        second_bucket = now_micros // RATE_BUCKET_ONE_SECOND_MICROS
        minute_bucket = now_micros // RATE_BUCKET_ONE_MINUTE_MICROS
        sec_key = (tenant_id, account_id, RATE_BUCKET_ONE_SECOND_MICROS, second_bucket)
        min_key = (tenant_id, account_id, RATE_BUCKET_ONE_MINUTE_MICROS, minute_bucket)
        second_count = store.get(sec_key, 0) + 1
        minute_count = store.get(min_key, 0) + 1
        granted = second_count <= max_per_second and minute_count <= max_per_minute
        if granted:
            store[sec_key] = second_count
            store[min_key] = minute_count
        else:
            second_count -= 1
            minute_count -= 1
        return RateReservation(
            granted=granted,
            kind=kind,
            tenant_id=tenant_id,
            account_id=account_id,
            second_count=second_count,
            minute_count=minute_count,
            second_bucket=second_bucket,
            minute_bucket=minute_bucket,
        )

    def rollback(self, reservation: RateReservation) -> None:
        if not reservation.granted:
            return
        store = self._store(reservation.kind)
        sec_key = (
            reservation.tenant_id,
            reservation.account_id,
            RATE_BUCKET_ONE_SECOND_MICROS,
            reservation.second_bucket,
        )
        min_key = (
            reservation.tenant_id,
            reservation.account_id,
            RATE_BUCKET_ONE_MINUTE_MICROS,
            reservation.minute_bucket,
        )
        if sec_key in store and store[sec_key] > 0:
            store[sec_key] -= 1
        if min_key in store and store[min_key] > 0:
            store[min_key] -= 1

    def state_at(
        self, tenant_id: str, account_id: str, now_micros: int
    ) -> RiskRateState:
        """Snapshot-shaped counts for a single tenant+account pair."""
        orders_second, orders_minute = self.counts(
            tenant_id, account_id, RiskRateKind.ORDERS, now_micros
        )
        cancels_second, cancels_minute = self.counts(
            tenant_id, account_id, RiskRateKind.CANCELS, now_micros
        )
        return RiskRateState(
            measured_at_micros=now_micros,
            orders_last_second=orders_second,
            orders_last_minute=orders_minute,
            cancels_last_second=cancels_second,
            cancels_last_minute=cancels_minute,
        )


#: Atomic consume-one for both windows of one kind. ``ARGV[3]``/``ARGV[4]``
#: carry the per-second and per-minute ceilings; ``granted`` is 0 when
#: either window would exceed its ceiling after the increment, and in that
#: case the script has already re-decremented both buckets. The ceilings are
#: passed per call, never baked into keys: limits change with the
#: configuration version, and a stale limit matched against a stale count is
#: exactly the drift this script exists to eliminate.
RATE_COUNTER_SCRIPT: Final[str] = """
local base = KEYS[1]
local kind = ARGV[1]
local now = tonumber(ARGV[2])
local max_second = tonumber(ARGV[3])
local max_minute = tonumber(ARGV[4])
local sec_bucket = math.floor(now / 1000000)
local min_bucket = math.floor(now / 60000000)
local sec_key = base .. ':' .. kind .. ':1:' .. sec_bucket
local min_key = base .. ':' .. kind .. ':60:' .. min_bucket
local s = redis.call('INCR', sec_key)
redis.call('EXPIRE', sec_key, 2)
local m = redis.call('INCR', min_key)
redis.call('EXPIRE', min_key, 120)
if s > max_second or m > max_minute then
  redis.call('DECR', sec_key)
  redis.call('DECR', min_key)
  return {s - 1, m - 1, 0}
end
return {s, m, 1}
"""

#: Release one previously granted slot (order died before transmission).
#: Only decrements when the bucket still exists; an expired bucket means the
#: event already aged out and there is nothing to roll back.
RATE_ROLLBACK_SCRIPT: Final[str] = """
local sec_key = ARGV[1]
local min_key = ARGV[2]
if redis.call('EXISTS', sec_key) == 1 then
  redis.call('DECR', sec_key)
end
if redis.call('EXISTS', min_key) == 1 then
  redis.call('DECR', min_key)
end
return 1
"""


def rate_bucket_keys(
    tenant_id: str, account_id: str, kind: str, now_micros: int
) -> tuple[str, str, int, int]:
    """Return ``(second_key, minute_key, second_bucket, minute_bucket)``.

    Exposed for the rollback path - a worker must DECR the *same* buckets it
    INCR'd, not whatever buckets "now" names a moment later - and for any
    Redis deployment wiring that needs to name ``KEYS[1]`` without
    duplicating the layout.
    """
    second_bucket = now_micros // RATE_BUCKET_ONE_SECOND_MICROS
    minute_bucket = now_micros // RATE_BUCKET_ONE_MINUTE_MICROS
    second_key = RedisKeys.risk_rate(
        tenant_id, account_id, kind, 1, second_bucket
    )
    minute_key = RedisKeys.risk_rate(
        tenant_id, account_id, kind, 60, minute_bucket
    )
    return second_key, minute_key, second_bucket, minute_bucket
