"""Signal identity, deduplication and cooldown.

Scope, stated up front so this is not confused with the Part 5 machinery: this
is *strategy-level* deduplication. It stops a strategy that re-evaluates on
every book tick from emitting the same opinion two hundred times a second. It
is bounded, in-memory and best-effort.

It is **not** exchange-order idempotency. That remains
:mod:`wlct_trading.idempotency` and the Part 5 execution engine, which derive a
deterministic ``clientOrderId`` and hold the authoritative duplicate guard. A
signal surviving deduplication here still passes through validation, the risk
engine and the execution engine's own duplicate detection before anything is
sent anywhere.

Both structures are bounded by construction. An unbounded dedup cache in a
process that sees a million events an hour is a memory leak with extra steps.
"""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.signals import Signal

__all__ = [
    "signal_identity",
    "SignalDeduplicator",
    "CooldownGate",
    "DEFAULT_DEDUP_CAPACITY",
]

#: Default number of identities retained. At ~40 bytes per entry this is well
#: under a megabyte and covers a busy instance for minutes.
DEFAULT_DEDUP_CAPACITY = 4_096


def signal_identity(signal: Signal) -> str:
    """Deterministic content identity of a signal.

    Two signals share an identity when they express the *same opinion*: same
    tenant, strategy instance, venue, symbol, action, size, order type and
    prices. Deliberately excluded:

    ``created_at`` / ``expires_at``
        Time is what makes a repeat a repeat. Including it would give every
        re-evaluation a fresh identity and defeat the purpose.
    ``signal_id``
        Unique per emission by construction.
    ``confidence``, ``reason``, ``features``, ``metadata``
        Explanatory, not instructive. A signal whose confidence moved from
        0.80 to 0.81 is the same instruction, and letting that through would
        turn a jittery feature into an order flood.
    """
    parts = (
        signal.tenant_id,
        signal.strategy_id,
        signal.strategy_version,
        signal.exchange.value,
        signal.symbol,
        signal.action.value,
        signal.order_type.value,
        signal.time_in_force.value,
        _decimal_token(signal.target_quantity),
        _decimal_token(signal.limit_price),
        _decimal_token(signal.stop_price),
    )
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:32]


def _decimal_token(value: Decimal | None) -> str:
    if value is None:
        return "-"
    # Normalised so that 1.50 and 1.5 are the same opinion.
    return str(value.normalize())


@dataclass(slots=True, frozen=True)
class DedupDecision:
    """Outcome of a deduplication check."""

    is_duplicate: bool
    identity: str
    first_seen_micros: int | None
    age_micros: int | None


class SignalDeduplicator:
    """Bounded TTL cache of recently seen signal identities.

    Eviction is least-recently-inserted once ``capacity`` is reached, and
    entries older than ``ttl_micros`` are treated as absent. Both bounds apply
    simultaneously: the TTL keeps the cache semantically correct and the
    capacity keeps it small even if the TTL is set generously.

    Not thread-safe and not shared between instances. One deduplicator belongs
    to one strategy instance, which is also what stops two instances from
    suppressing each other's signals.
    """

    __slots__ = ("_ttl_micros", "_capacity", "_seen")

    def __init__(
        self, *, ttl_micros: int, capacity: int = DEFAULT_DEDUP_CAPACITY
    ) -> None:
        if ttl_micros <= 0:
            raise ValueError("SignalDeduplicator ttl_micros must be positive.")
        if capacity < 1:
            raise ValueError("SignalDeduplicator capacity must be at least 1.")
        self._ttl_micros = ttl_micros
        self._capacity = capacity
        self._seen: "OrderedDict[str, int]" = OrderedDict()

    @property
    def ttl_micros(self) -> int:
        return self._ttl_micros

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def size(self) -> int:
        return len(self._seen)

    def check(self, signal: Signal, *, now_micros: int) -> DedupDecision:
        """Test a signal without recording it."""
        identity = signal_identity(signal)
        first_seen = self._seen.get(identity)
        if first_seen is None:
            return DedupDecision(False, identity, None, None)
        age = now_micros - first_seen
        if age > self._ttl_micros:
            return DedupDecision(False, identity, first_seen, age)
        return DedupDecision(True, identity, first_seen, age)

    def register(self, signal: Signal, *, now_micros: int) -> str:
        """Record a signal as seen. Returns its identity."""
        identity = signal_identity(signal)
        self._seen.pop(identity, None)
        self._seen[identity] = now_micros
        self._evict(now_micros)
        return identity

    def check_and_register(self, signal: Signal, *, now_micros: int) -> DedupDecision:
        """Atomic test-then-record.

        A duplicate does **not** refresh the stored timestamp. Refreshing would
        let a strategy repeating the same opinion every millisecond keep the
        entry alive forever and never re-emit, which is the opposite of what a
        TTL is for.
        """
        decision = self.check(signal, now_micros=now_micros)
        if not decision.is_duplicate:
            self.register(signal, now_micros=now_micros)
        return decision

    def _evict(self, now_micros: int) -> None:
        cutoff = now_micros - self._ttl_micros
        while self._seen:
            oldest_identity, oldest_at = next(iter(self._seen.items()))
            if oldest_at >= cutoff:
                break
            self._seen.popitem(last=False)
        while len(self._seen) > self._capacity:
            self._seen.popitem(last=False)

    def reset(self) -> None:
        self._seen.clear()

    def to_dict(self) -> dict[str, object]:
        return {
            "size": self.size,
            "capacity": self._capacity,
            "ttlMicros": self._ttl_micros,
        }


class CooldownGate:
    """Minimum spacing between actionable signals for one instance.

    Separate from deduplication because it answers a different question.
    Deduplication asks "have I said this already?"; the cooldown asks "have I
    said *anything* recently?". A strategy that alternates BUY and SELL every
    tick defeats deduplication entirely and is exactly what this catches.

    ``HOLD`` never starts a cooldown: it is a recorded non-action, and letting
    it suppress the next real decision would be wrong.
    """

    __slots__ = ("_cooldown_micros", "_last_emitted_micros")

    def __init__(self, *, cooldown_micros: int) -> None:
        if cooldown_micros < 0:
            raise ValueError("CooldownGate cooldown_micros must not be negative.")
        self._cooldown_micros = cooldown_micros
        self._last_emitted_micros: int | None = None

    @property
    def cooldown_micros(self) -> int:
        return self._cooldown_micros

    @property
    def last_emitted_micros(self) -> int | None:
        return self._last_emitted_micros

    def is_open(self, *, now_micros: int) -> bool:
        """Whether an actionable signal may be emitted now."""
        if self._cooldown_micros == 0 or self._last_emitted_micros is None:
            return True
        return now_micros - self._last_emitted_micros >= self._cooldown_micros

    def remaining_micros(self, *, now_micros: int) -> int:
        if self._last_emitted_micros is None:
            return 0
        remaining = self._cooldown_micros - (now_micros - self._last_emitted_micros)
        return remaining if remaining > 0 else 0

    def record_emission(self, *, now_micros: int) -> None:
        self._last_emitted_micros = now_micros

    def reset(self) -> None:
        self._last_emitted_micros = None
