"""Exponential backoff with full jitter.

A reconnect loop without backoff is a denial-of-service attack on the venue and
a reliable way to get an IP banned. A reconnect loop *with* backoff but without
jitter is worse in a fleet: every worker that lost the same upstream retries in
lockstep, producing a synchronised thundering herd at exactly the moment the
venue is least able to absorb it.

This implements capped exponential backoff with full jitter — the delay for
attempt *n* is drawn uniformly from ``[0, min(cap, base * 2**n))``. Full jitter
spreads retries across the whole window and is the variant that measurably
minimises both contention and completion time compared with equal-jitter or
decorrelated schemes for this shape of workload.

The generator is injectable so tests are deterministic: pass ``jitter=False``
for exact delays, or supply a seeded ``random.Random``.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

__all__ = ["ExponentialBackoff", "BackoffConfig"]


@dataclass(slots=True, frozen=True)
class BackoffConfig:
    """Tunable backoff parameters.

    Defaults are chosen for exchange websockets: a first retry fast enough that
    a one-second blip is invisible, a ceiling low enough that recovery after a
    long outage is prompt, and an attempt cap so a permanently broken endpoint
    eventually surfaces as an alert instead of retrying silently forever.
    """

    base_delay_millis: int = 500
    max_delay_millis: int = 30_000
    multiplier: float = 2.0
    #: Hard stop. ``None`` permits unlimited attempts, which is only ever
    #: appropriate for a long-lived market-data feed that must self-heal.
    max_attempts: int | None = None
    jitter: bool = True

    def __post_init__(self) -> None:
        if self.base_delay_millis <= 0:
            raise ValueError("base_delay_millis must be positive.")
        if self.max_delay_millis < self.base_delay_millis:
            raise ValueError("max_delay_millis must be >= base_delay_millis.")
        if self.multiplier < 1.0:
            raise ValueError("multiplier must be >= 1.0.")
        if self.max_attempts is not None and self.max_attempts < 0:
            raise ValueError("max_attempts must be non-negative.")


@dataclass(slots=True)
class ExponentialBackoff:
    """Stateful backoff sequence for one connection.

    Usage::

        backoff = ExponentialBackoff(BackoffConfig())
        while not connected:
            if not backoff.can_retry():
                raise RuntimeError("giving up")
            await asyncio.sleep(backoff.next_delay_millis() / 1000)
        backoff.reset()

    :meth:`reset` must be called on a successful connection, otherwise the
    delay keeps growing across unrelated outages and a feed that drops once an
    hour ends up waiting the maximum every time.
    """

    config: BackoffConfig = field(default_factory=BackoffConfig)
    _attempt: int = 0
    _rng: random.Random = field(default_factory=random.Random)

    @property
    def attempt(self) -> int:
        """How many delays have been issued since the last reset."""
        return self._attempt

    def can_retry(self) -> bool:
        """Whether another attempt is permitted by the attempt cap."""
        if self.config.max_attempts is None:
            return True
        return self._attempt < self.config.max_attempts

    def peek_delay_millis(self, *, multiplier: float = 1.0) -> int:
        """Uncapped-by-jitter delay for the next attempt, without consuming it.

        Used for logging "next retry in Ns" without advancing the sequence.
        """
        return self._ceiling_for(self._attempt, multiplier)

    def next_delay_millis(self, *, multiplier: float = 1.0) -> int:
        """Consume one attempt and return how long to wait, in milliseconds.

        ``multiplier`` lets an error category stretch the delay — a rate-limit
        rejection should pause far longer than a dropped socket. See
        ``RETRY_POLICIES`` in :mod:`wlct_trading.transport.errors`.
        """
        ceiling = self._ceiling_for(self._attempt, multiplier)
        self._attempt += 1
        if not self.config.jitter:
            return ceiling
        # Full jitter: uniform over the whole window, including near-zero.
        return self._rng.randint(0, ceiling)

    def reset(self) -> None:
        """Clear the sequence after a successful connection."""
        self._attempt = 0

    def _ceiling_for(self, attempt: int, multiplier: float) -> int:
        """Delay ceiling for a given attempt index, capped and non-negative."""
        if multiplier <= 0:
            raise ValueError("multiplier must be positive.")
        # Compute in float then clamp; 2**attempt overflows int only at absurd
        # attempt counts but the cap makes the result meaningless long before.
        raw = self.config.base_delay_millis * (self.config.multiplier**attempt)
        scaled = raw * multiplier
        capped = min(scaled, float(self.config.max_delay_millis))
        return max(1, int(capped))
