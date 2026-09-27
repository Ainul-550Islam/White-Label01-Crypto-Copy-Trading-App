"""Order-book microstructure features.

Every function here is a pure function of one normalised market-data object.
None of them holds state, none of them reads a clock, and none of them can
raise on ordinary input: a value that cannot be computed is returned as
``None``.

Definitions are written out explicitly because "imbalance" and "spread" both
have several defensible definitions in the literature, and a strategy tuned
against one behaves differently under another.
"""

from __future__ import annotations

from decimal import Decimal

from wlct_trading.market_data import BookTop, OrderBookSnapshot, PriceLevel
from wlct_trading.strategies.features.rolling import safe_ratio

__all__ = [
    "mid_price",
    "spread",
    "spread_percent",
    "spread_basis_points",
    "order_book_imbalance",
    "weighted_mid_price",
    "depth_imbalance",
    "top_of_book_notional",
]

_ZERO = Decimal(0)
_TWO = Decimal(2)
_HUNDRED = Decimal(100)
_TEN_THOUSAND = Decimal(10_000)


def mid_price(top: BookTop) -> Decimal | None:
    """Arithmetic mid: ``(best_bid + best_ask) / 2``.

    ``None`` when either side is missing - a one-sided book has no mid, and
    substituting the single available side would silently misprice everything
    downstream.
    """
    if top.best_bid is None or top.best_ask is None:
        return None
    return (top.best_bid + top.best_ask) / _TWO


def spread(top: BookTop) -> Decimal | None:
    """Absolute spread in quote currency: ``best_ask - best_bid``."""
    if top.best_bid is None or top.best_ask is None:
        return None
    return top.best_ask - top.best_bid


def spread_percent(top: BookTop) -> Decimal | None:
    """Spread as a percentage of the mid price.

    Mid is the denominator by convention: using bid or ask would make the
    figure asymmetric between the two sides of the same book.
    """
    mid = mid_price(top)
    absolute = spread(top)
    if mid is None or absolute is None:
        return None
    ratio = safe_ratio(absolute, mid)
    if ratio is None:
        return None
    return ratio * _HUNDRED


def spread_basis_points(top: BookTop) -> Decimal | None:
    """Spread in basis points of the mid price. ``1 bp = 0.01%``."""
    mid = mid_price(top)
    absolute = spread(top)
    if mid is None or absolute is None:
        return None
    ratio = safe_ratio(absolute, mid)
    if ratio is None:
        return None
    return ratio * _TEN_THOUSAND


def order_book_imbalance(
    bid_quantity: Decimal | None, ask_quantity: Decimal | None
) -> Decimal | None:
    """Top-of-book volume imbalance.

    Definition used throughout this project::

        imbalance = (bid_volume - ask_volume) / (bid_volume + ask_volume)

    The result is bounded in ``[-1, +1]``:

    * ``+1``  all displayed volume is on the bid (no ask size)
    * ``0``   both sides show equal size
    * ``-1``  all displayed volume is on the ask (no bid size)

    ``None`` is returned when either quantity is missing, when either is
    negative (a corrupt book), or when the denominator is zero. A zero
    denominator is *not* reported as zero imbalance: "both sides empty" and
    "both sides equal" are different facts, and collapsing them would let an
    empty book look balanced.

    This is a displayed-size statistic at the touch only. It says nothing about
    hidden liquidity, queue position or the depth behind the touch, and it is
    not a prediction of the next price move.
    """
    if bid_quantity is None or ask_quantity is None:
        return None
    if bid_quantity < _ZERO or ask_quantity < _ZERO:
        return None
    total = bid_quantity + ask_quantity
    return safe_ratio(bid_quantity - ask_quantity, total)


def weighted_mid_price(top: BookTop) -> Decimal | None:
    """Size-weighted mid, sometimes called the micro-price.

    ::

        weighted_mid = (bid * ask_size + ask * bid_size) / (bid_size + ask_size)

    The larger side pulls the estimate towards the *opposite* price, which is
    the usual formulation: heavy bid size means the next trade is more likely
    to happen at the ask. Falls back to ``None`` - never to the arithmetic mid -
    when sizes are unavailable, so a caller cannot mistake one for the other.
    """
    if top.best_bid is None or top.best_ask is None:
        return None
    bid_size = top.best_bid_quantity
    ask_size = top.best_ask_quantity
    if bid_size is None or ask_size is None:
        return None
    if bid_size < _ZERO or ask_size < _ZERO:
        return None
    total = bid_size + ask_size
    return safe_ratio(top.best_bid * ask_size + top.best_ask * bid_size, total)


def _sum_quantity(levels: tuple[PriceLevel, ...], depth: int) -> Decimal | None:
    if depth < 1:
        return None
    if len(levels) < depth:
        return None
    total = _ZERO
    for level in levels[:depth]:
        if level.quantity < _ZERO:
            return None
        total += level.quantity
    return total


def depth_imbalance(snapshot: OrderBookSnapshot, *, depth: int = 5) -> Decimal | None:
    """Imbalance over the first ``depth`` levels of each side.

    Same definition as :func:`order_book_imbalance`, applied to summed depth
    rather than the touch. ``None`` when either side has fewer than ``depth``
    levels: truncating one side would bias the ratio towards the deeper book.
    """
    bid_volume = _sum_quantity(snapshot.bids, depth)
    ask_volume = _sum_quantity(snapshot.asks, depth)
    return order_book_imbalance(bid_volume, ask_volume)


def top_of_book_notional(top: BookTop) -> Decimal | None:
    """Combined quote-currency value resting at the touch.

    ``bid * bid_size + ask * ask_size``. A rough liquidity gauge; ``None`` when
    any component is missing.
    """
    if (
        top.best_bid is None
        or top.best_ask is None
        or top.best_bid_quantity is None
        or top.best_ask_quantity is None
    ):
        return None
    return top.best_bid * top.best_bid_quantity + top.best_ask * top.best_ask_quantity
