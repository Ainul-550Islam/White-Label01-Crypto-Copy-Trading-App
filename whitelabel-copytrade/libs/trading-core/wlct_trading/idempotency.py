"""Deterministic client order ids and duplicate-submission protection.

A network timeout on an order submission is genuinely ambiguous: the venue may
have accepted the order, or may never have seen it. Blindly retrying doubles
the position; never retrying silently drops it. The standard resolution is to
attach a caller-generated id to every submission so the venue itself can
recognise the retry - that is what :func:`build_client_order_id` produces.

The id is derived, not random, so the *same* logical intent always produces the
*same* id no matter which worker processes it. Two workers racing on the same
signal therefore collide on the venue instead of both getting filled.
"""

from __future__ import annotations

import hashlib
import re
from decimal import Decimal

from wlct_trading.orders import OrderIntent

__all__ = [
    "build_client_order_id",
    "intent_fingerprint",
    "DuplicateOrderGuard",
    "CLIENT_ORDER_ID_PATTERN",
]

#: Venues are restrictive about client order ids. Alphanumerics, dash and
#: underscore are accepted everywhere we integrate with.
CLIENT_ORDER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,36}$")

_PREFIX = "wlct"


def intent_fingerprint(intent: OrderIntent) -> str:
    """Stable hash of the economically meaningful fields of an intent.

    Deliberately excludes timestamps and the internal order id: two intents
    that would place the same trade must fingerprint identically. It *includes*
    ``signal_id`` so that two separate signals asking for the same trade remain
    distinguishable - suppressing those would be a strategy bug to surface, not
    a duplicate to swallow.
    """
    parts = (
        intent.tenant_id,
        intent.account_id,
        intent.strategy_id or "-",
        intent.signal_id or "-",
        intent.exchange.value,
        intent.symbol,
        intent.side.value,
        intent.order_type.value,
        _normalise_decimal(intent.quantity),
        _normalise_decimal(intent.price),
        _normalise_decimal(intent.stop_price),
        intent.time_in_force.value,
        "1" if intent.reduce_only else "0",
    )
    joined = "|".join(parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def build_client_order_id(intent: OrderIntent) -> str:
    """Derive a venue-safe, deterministic client order id from an intent.

    Format: ``wlct-<28 hex chars>`` - 33 characters, inside the 36-character
    limit of every venue we support, with 112 bits of the fingerprint retained.
    That is far more than enough to make an accidental collision between two
    genuinely different intents impossible in practice.
    """
    fingerprint = intent_fingerprint(intent)
    candidate = f"{_PREFIX}-{fingerprint[:28]}"
    if not CLIENT_ORDER_ID_PATTERN.match(candidate):  # pragma: no cover - defensive
        raise ValueError(f"Generated client order id {candidate!r} is not venue-safe.")
    return candidate


def _normalise_decimal(value: Decimal | None) -> str:
    """Canonical string form so ``1.50`` and ``1.5`` fingerprint identically."""
    if value is None:
        return "-"
    normalised = value.normalize()
    # ``normalize`` renders small integers in scientific notation (``1E+2``);
    # expand that back so the fingerprint stays human-readable and stable.
    sign, digits, exponent = normalised.as_tuple()
    if isinstance(exponent, int) and exponent > 0:
        normalised = normalised.quantize(Decimal(1))
    return format(normalised, "f")


class DuplicateOrderGuard:
    """In-process guard against submitting the same client order id twice.

    This is the *first* line of defence and covers the common case of a retry
    within one worker. It is not sufficient on its own: the authoritative check
    is the unique index on ``(tenant_id, client_order_id)`` in PostgreSQL plus
    the venue's own handling of a repeated client order id. All three layers
    are intentional - the in-process guard is fast, the database guard is
    correct across workers, and the venue guard is correct across deployments.
    """

    __slots__ = ("_seen",)

    def __init__(self) -> None:
        self._seen: set[str] = set()

    def register(self, client_order_id: str) -> bool:
        """Record an id. Returns ``False`` if it had already been registered."""
        if client_order_id in self._seen:
            return False
        self._seen.add(client_order_id)
        return True

    def has_seen(self, client_order_id: str) -> bool:
        return client_order_id in self._seen

    def release(self, client_order_id: str) -> None:
        """Forget an id, e.g. after the venue definitively rejected it."""
        self._seen.discard(client_order_id)

    def __len__(self) -> int:
        return len(self._seen)
