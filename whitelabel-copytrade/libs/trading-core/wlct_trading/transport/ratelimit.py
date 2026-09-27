"""Rate-limit awareness for REST and websocket operations.

Exchanges do not charge one unit per request. Binance bills each REST endpoint a
"weight" against a per-minute budget (a deep order-book snapshot costs far more
than a ping) and separately caps websocket messages per second and streams per
connection. Counting requests instead of weight will get an IP banned while the
request counter still looks comfortable.

So this module tracks a weighted budget over a sliding window, plus a separate
short-window limiter for websocket control frames.

Two design points worth stating:

* **Reserve before sending, not after.** :meth:`WeightedRateLimiter.try_acquire`
  is called before the request goes out. Deducting afterwards means the budget
  is already blown by the time it is noticed.
* **Never block indefinitely.** The limiter reports how long a caller would have
  to wait; it does not sleep on the caller's behalf and it does not retry. Retry
  policy belongs in one place — :mod:`wlct_trading.transport.errors` — and
  unbounded internal retries are exactly what this codebase forbids.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from wlct_trading.clock import epoch_micros

__all__ = [
    "RateLimitRule",
    "RateLimitDecision",
    "WeightedRateLimiter",
    "RateLimitRegistry",
]

_MICROS_PER_SECOND = 1_000_000


@dataclass(slots=True, frozen=True)
class RateLimitRule:
    """One budget: ``capacity`` units per ``window_seconds``."""

    name: str
    capacity: int
    window_seconds: int

    def __post_init__(self) -> None:
        if self.capacity <= 0:
            raise ValueError("capacity must be positive.")
        if self.window_seconds <= 0:
            raise ValueError("window_seconds must be positive.")

    @property
    def window_micros(self) -> int:
        return self.window_seconds * _MICROS_PER_SECOND


@dataclass(slots=True, frozen=True)
class RateLimitDecision:
    """Whether an operation may proceed, and if not, when to try again."""

    allowed: bool
    rule_name: str
    consumed: int
    remaining: int
    #: How long until enough budget frees up. Zero when allowed.
    retry_after_millis: int = 0

    @property
    def utilisation_percent(self) -> float:
        total = self.consumed + self.remaining
        if total <= 0:
            return 0.0
        return (self.consumed / total) * 100.0


class WeightedRateLimiter:
    """Sliding-window limiter over weighted units.

    Entries are ``(timestamp, weight)`` in a deque, evicted once they fall out
    of the window. Memory is bounded by the request rate rather than the window
    length, which for exchange traffic is a few hundred entries at most.

    A true token bucket would be cheaper but permits a full-capacity burst
    immediately after a quiet period, which is precisely the pattern that trips
    exchange burst detection. The sliding window is the accurate model of how
    venues actually account.
    """

    __slots__ = ("_rule", "_entries", "_consumed")

    def __init__(self, rule: RateLimitRule) -> None:
        self._rule = rule
        self._entries: deque[tuple[int, int]] = deque()
        self._consumed = 0

    @property
    def rule(self) -> RateLimitRule:
        return self._rule

    def _evict(self, now: int) -> None:
        cutoff = now - self._rule.window_micros
        while self._entries and self._entries[0][0] <= cutoff:
            _, weight = self._entries.popleft()
            self._consumed -= weight

    def consumed(self, *, now_micros: int | None = None) -> int:
        now = epoch_micros() if now_micros is None else now_micros
        self._evict(now)
        return self._consumed

    def remaining(self, *, now_micros: int | None = None) -> int:
        return max(0, self._rule.capacity - self.consumed(now_micros=now_micros))

    def try_acquire(
        self, weight: int = 1, *, now_micros: int | None = None
    ) -> RateLimitDecision:
        """Reserve ``weight`` units if the budget allows.

        On refusal nothing is consumed and ``retry_after_millis`` says how long
        until the oldest entries age out and free enough room.
        """
        if weight <= 0:
            raise ValueError("weight must be positive.")
        now = epoch_micros() if now_micros is None else now_micros
        self._evict(now)

        if self._consumed + weight <= self._rule.capacity:
            self._entries.append((now, weight))
            self._consumed += weight
            return RateLimitDecision(
                allowed=True,
                rule_name=self._rule.name,
                consumed=self._consumed,
                remaining=self._rule.capacity - self._consumed,
            )

        return RateLimitDecision(
            allowed=False,
            rule_name=self._rule.name,
            consumed=self._consumed,
            remaining=max(0, self._rule.capacity - self._consumed),
            retry_after_millis=self._retry_after_millis(weight, now),
        )

    def _retry_after_millis(self, weight: int, now: int) -> int:
        """When enough entries will have expired to admit ``weight`` units."""
        if weight > self._rule.capacity:
            # Can never be satisfied; report the full window rather than
            # implying a shorter wait would help.
            return self._rule.window_seconds * 1_000

        needed = (self._consumed + weight) - self._rule.capacity
        freed = 0
        for timestamp, entry_weight in self._entries:
            freed += entry_weight
            if freed >= needed:
                expires_at = timestamp + self._rule.window_micros
                return max(1, (expires_at - now) // 1_000)
        return self._rule.window_seconds * 1_000

    def reset(self) -> None:
        self._entries.clear()
        self._consumed = 0


@dataclass(slots=True)
class RateLimitRegistry:
    """The set of budgets that apply to one exchange connection.

    A single operation can be subject to several at once — a REST snapshot
    consumes both request-count and weight budgets — so
    :meth:`try_acquire_all` checks them together and only commits if every
    budget can accommodate it.
    """

    limiters: dict[str, WeightedRateLimiter] = field(default_factory=dict)

    @classmethod
    def from_rules(cls, rules: tuple[RateLimitRule, ...]) -> "RateLimitRegistry":
        return cls(limiters={r.name: WeightedRateLimiter(r) for r in rules})

    def add(self, rule: RateLimitRule) -> None:
        self.limiters[rule.name] = WeightedRateLimiter(rule)

    def get(self, name: str) -> WeightedRateLimiter | None:
        return self.limiters.get(name)

    def try_acquire(
        self, name: str, weight: int = 1, *, now_micros: int | None = None
    ) -> RateLimitDecision:
        limiter = self.limiters.get(name)
        if limiter is None:
            raise KeyError(f"No rate-limit rule named {name!r} is registered.")
        return limiter.try_acquire(weight, now_micros=now_micros)

    def try_acquire_all(
        self, weights: dict[str, int], *, now_micros: int | None = None
    ) -> tuple[bool, tuple[RateLimitDecision, ...]]:
        """All-or-nothing reservation across several budgets.

        Availability is checked on every budget first, and units are only
        deducted once all of them agree. A partial deduction followed by a
        refusal would leak budget on every rejected attempt.
        """
        now = epoch_micros() if now_micros is None else now_micros

        for name, weight in weights.items():
            limiter = self.limiters.get(name)
            if limiter is None:
                raise KeyError(f"No rate-limit rule named {name!r} is registered.")
            if limiter.remaining(now_micros=now) < weight:
                refusal = RateLimitDecision(
                    allowed=False,
                    rule_name=name,
                    consumed=limiter.consumed(now_micros=now),
                    remaining=limiter.remaining(now_micros=now),
                    retry_after_millis=limiter._retry_after_millis(weight, now),
                )
                return False, (refusal,)

        decisions = tuple(
            self.limiters[name].try_acquire(weight, now_micros=now)
            for name, weight in weights.items()
        )
        return True, decisions

    def snapshot(self, *, now_micros: int | None = None) -> dict[str, dict[str, int]]:
        """Utilisation of every budget, for health endpoints and metrics."""
        now = epoch_micros() if now_micros is None else now_micros
        return {
            name: {
                "capacity": limiter.rule.capacity,
                "consumed": limiter.consumed(now_micros=now),
                "remaining": limiter.remaining(now_micros=now),
                "windowSeconds": limiter.rule.window_seconds,
            }
            for name, limiter in self.limiters.items()
        }

    def reset(self) -> None:
        for limiter in self.limiters.values():
            limiter.reset()
