"""The exposure calculator: positions, open-order reservations and projection.

This is the arithmetic the rest of the risk engine defers to, and the
reservation model is the whole reason it exists. Stated exactly:

**Reservation model.** For every order in an *open* status
(``OPEN_ORDER_STATUSES``) the venue has accepted but not completed:

* ``unfilled = max(quantity - filled_quantity, 0)``
* signed delta ``d_i = unfilled * side.sign``
* a **reduce-only** order can only move the position toward zero: its
  effective delta is the same-direction move *clipped at flat* - it may
  reduce or flatten an exposure but can never open an opposite one. A
  reduce-only order that would flip the side is clipped to flat; the venue
  rejects the flip anyway, and the risk engine must not grant budget to
  exposure the exchange will not fill.
* a **non-reduce** order contributes its full signed delta unconditionally.

Reservations are applied to the current position one at a time, in a fixed
deterministic order (symbol, then client_order_id, ascending) - order
matters when several open orders on both sides compete for the same book,
and "the engine's answer depends on dict iteration order" is exactly the
class of bug a projection must not ship with. The same clipping rule then
applies to the *new* order, and the result is the projected state:

    projected_position = current + reservations + new_order

Exposure notionals are valued with the caller-supplied authoritative
reference price (mark or best quote) - never with the order's own limit
price, which is a request, not a fact about the market.

All arithmetic is ``Decimal``. Nothing here rounds or quantizes; quantization
is a venue-rule concern and lives in validation.

Cross-strategy rule: symbol and account buckets aggregate *all* strategies.
Strategy buckets partition by attribution. A strategy therefore cannot treat
the account budget as "the other strategy's problem": the account rule
checks the same aggregate the strategy rules sum over, and only the tightest
governs, which is enforced by configuration resolution, not by trust.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

from wlct_trading.enums import (
    OPEN_ORDER_STATUSES,
    MarketType,
    OrderSide,
    OrderStatus,
    OrderType,
)

__all__ = [
    "ExposureDimension",
    "ExposureBucket",
    "ExposureBreakdown",
    "OpenOrderView",
    "PositionView",
    "ReferenceView",
    "ProjectingContext",
    "reservation_delta",
    "clip_toward_zero",
    "project_position",
    "build_breakdown",
]

_ZERO = Decimal(0)


class ExposureDimension(str, Enum):
    """The buckets exposure is aggregated into. Stable wire values."""

    SYMBOL = "SYMBOL"
    STRATEGY = "STRATEGY"
    ACCOUNT = "ACCOUNT"
    EXCHANGE = "EXCHANGE"
    CORRELATION_GROUP = "CORRELATION_GROUP"


@dataclass(slots=True, frozen=True)
class ExposureBucket:
    """One dimension-target pair: ``SYMBOL/BTC-USDT`` at ``x`` notional.

    ``gross_notional`` is the absolute exposure (what a ceiling constrains).
    ``net_signed_notional`` keeps direction, for reporting and for the
    ledger; ceilings never use it, because a net of zero built from two
    large opposite legs is not "no risk".
    """

    dimension: ExposureDimension
    target: str
    gross_notional: Decimal
    net_signed_notional: Decimal
    #: Inclusion provenance: which symbols composed this bucket. Report size
    #: is bounded by the number of open positions, not by ticks.
    members: tuple[str, ...] = ()


@dataclass(slots=True, frozen=True)
class ExposureBreakdown:
    """Every bucket at once, deterministic and cheap to recompute.

    Built from snapshot state by :func:`build_breakdown`; it carries no
    clock, no I/O and no order, which is what makes it directly testable and
    what allows the gate to rebuild it mid-evaluation (e.g. after projecting
    the candidate order) without any risk of the two builds disagreeing.
    """

    buckets: tuple[ExposureBucket, ...]
    #: Account-level gross notional across *all* exchanges held in the
    #: snapshot. Kept as an explicit field because every consumer of the
    #: account ceiling reads exactly this number, and re-summing buckets
    #: would silently include EXCHANGE-dimension rows twice.
    account_gross_notional: Decimal

    def bucket(self, dimension: ExposureDimension, target: str) -> ExposureBucket | None:
        for item in self.buckets:
            if item.dimension is dimension and item.target == target:
                return item
        return None

    def total_for(self, dimension: ExposureDimension) -> Decimal:
        return sum(
            (b.gross_notional for b in self.buckets if b.dimension is dimension),
            _ZERO,
        )

    def to_payload(self) -> dict[str, object]:
        return {
            "accountGrossNotional": str(self.account_gross_notional),
            "buckets": [
                {
                    "dimension": bucket.dimension.value,
                    "target": bucket.target,
                    "grossNotional": str(bucket.gross_notional),
                    "netSignedNotional": str(bucket.net_signed_notional),
                    "members": list(bucket.members),
                }
                for bucket in self.buckets
            ],
        }


@dataclass(slots=True, frozen=True)
class PositionView:
    """Net signed position on one venue symbol. ``quantity`` is signed."""

    exchange: str
    symbol: str
    quantity: Decimal

    def gross_notional_at(self, price: Decimal) -> Decimal:
        return abs(self.quantity) * price


@dataclass(slots=True, frozen=True)
class ReferenceView:
    """Authoritative valuation reference for one venue symbol."""

    exchange: str
    symbol: str
    price: Decimal
    #: Which market fact produced it, for the audit trail (mid/touch/last).
    source: str = "mark"


@dataclass(slots=True, frozen=True)
class OpenOrderView:
    """What exposure maths needs from one resting order. No lifecycle, no I/O.

    Status is caller-validated upstream: an order in a terminal status must
    not appear here at all (that is a bug in the loader), and
    :meth:`ProjectingContext.integrity_errors` rejects one rather than
    silently ignoring it, because silently ignoring corrupt state is the one
    thing this engine is not permitted to do.
    """

    client_order_id: str
    exchange: str
    symbol: str
    side: OrderSide
    order_type: OrderType
    status: OrderStatus
    quantity: Decimal
    filled_quantity: Decimal
    is_reduce_only: bool
    strategy_id: str | None = None
    limit_price: Decimal | None = None

    @property
    def unfilled_quantity(self) -> Decimal:
        return max(self.quantity - self.filled_quantity, _ZERO)

    @property
    def signed_unfilled(self) -> Decimal:
        return self.unfilled_quantity * Decimal(self.side.sign)


@dataclass(slots=True, frozen=True)
class ProjectingContext:
    """The state a projection consumes, with its own integrity checks.

    Centralised so that live evaluation, replay and the reservation ledger
    all apply the *same* sanity rules to the same shapes - three call sites,
    one definition of "this state is usable".
    """

    positions: tuple[PositionView, ...]
    open_orders: tuple[OpenOrderView, ...]
    references: tuple[ReferenceView, ...]

    def reference_map(self) -> dict[tuple[str, str], Decimal]:
        return {(r.exchange, r.symbol): r.price for r in self.references}

    def integrity_errors(self) -> tuple[str, ...]:
        """Reasons this state cannot be trusted for projection.

        Returns the empty tuple when every input survives scrutiny. Note
        what is *not* tolerated: terminal-status orders mixed into the open
        set (double counting once the fill lands), ``filled > quantity``
        (either a venue anomaly or a loader bug; both must stop the line,
        not skew the maths), missing reference prices for symbols with
        exposure (valuing that leg at zero would *understate* exposure, the
        one error direction this engine may not make), duplicate identities,
        and non-positive references.
        """
        errors: list[str] = []
        references = self.reference_map()

        position_keys: set[tuple[str, str]] = set()
        for position in self.positions:
            key = (position.exchange, position.symbol)
            if key in position_keys:
                errors.append(f"duplicate position for {position.exchange}/{position.symbol}")
            position_keys.add(key)
            if position.quantity != position.quantity:  # NaN guard, Decimal-safe
                errors.append(f"position on {position.exchange}/{position.symbol} is not a number")
            if key not in references and position.quantity != _ZERO:
                errors.append(
                    f"position on {position.exchange}/{position.symbol} has no reference price"
                )

        order_ids: set[str] = set()
        for order in self.open_orders:
            if order.client_order_id in order_ids:
                errors.append(f"duplicate client_order_id {order.client_order_id}")
            order_ids.add(order.client_order_id)
            if order.status not in OPEN_ORDER_STATUSES:
                errors.append(
                    f"open-order set contains {order.client_order_id} in "
                    f"terminal status {order.status.value}"
                )
            if order.quantity < _ZERO:
                errors.append(f"order {order.client_order_id} has negative quantity")
            if order.filled_quantity < _ZERO:
                errors.append(
                    f"order {order.client_order_id} has negative filled quantity"
                )
            if order.filled_quantity > order.quantity:
                errors.append(
                    f"order {order.client_order_id} reports more filled "
                    f"({order.filled_quantity}) than placed ({order.quantity})"
                )
            if (order.exchange, order.symbol) not in references:
                errors.append(
                    f"order {order.client_order_id} on {order.exchange}/{order.symbol} "
                    "has no reference price"
                )

        for reference in self.references:
            if reference.price <= _ZERO or reference.price != reference.price:
                errors.append(
                    f"reference price for {reference.exchange}/{reference.symbol} "
                    "is not positive"
                )
        return tuple(errors)


def clip_toward_zero(current_signed: Decimal, signed_delta: Decimal) -> Decimal:
    """The portion of ``signed_delta`` that moves ``current_signed`` toward flat.

    A reduce-only order (or a reduce-only *intent*) may reduce or flatten,
    never flip. ``+5`` with a ``-7`` reduce-only delta contributes ``-5``.
    From flat, a reduce-only order contributes nothing: there is nothing to
    reduce, and the venue would reject it; valuing it as exposure would be
    inventing a position the exchange cannot fill.
    """
    if current_signed == _ZERO:
        return _ZERO
    projected = current_signed + signed_delta
    same_side = (current_signed > _ZERO) == (projected > _ZERO) and projected != _ZERO
    if same_side:
        return signed_delta
    return -current_signed


def reservation_delta(order: OpenOrderView, current_signed: Decimal) -> Decimal:
    """The signed quantity one open order contributes to the projection."""
    signed = order.signed_unfilled
    if order.is_reduce_only:
        return clip_toward_zero(current_signed, signed)
    return signed


def orders_for(
    orders: tuple[OpenOrderView, ...], exchange: str, symbol: str
) -> tuple[OpenOrderView, ...]:
    """Deterministically ordered reservations for one venue symbol."""
    return tuple(
        sorted(
            (o for o in orders if o.exchange == exchange and o.symbol == symbol),
            key=lambda o: (o.symbol, o.client_order_id),
        )
    )


def project_position(
    current_signed: Decimal,
    orders: tuple[OpenOrderView, ...],
    *,
    new_delta: Decimal | None = None,
    new_is_reduce_only: bool = False,
) -> Decimal:
    """Position after reservations and (optionally) the candidate order.

    Deterministic application order: reservations sorted by
    ``(symbol, client_order_id)`` ascending, so a slice and the whole never
    disagree about the relative order of two ids.
    """
    position = current_signed
    for order in sorted(orders, key=lambda o: (o.symbol, o.client_order_id)):
        position = position + reservation_delta(order, position)
    if new_delta is not None:
        if new_is_reduce_only:
            position = position + clip_toward_zero(position, new_delta)
        else:
            position = position + new_delta
    return position


def build_breakdown(
    context: ProjectingContext,
    *,
    market_type: MarketType = MarketType.SPOT,
) -> ExposureBreakdown:
    """Aggregate gross/net notionals across symbols, strategies and venues.

    ``market_type`` is a forward hook, documented rather than guessed:
    notional *is* a property of the instrument, and when a derivatives
    market type is introduced its valuation rule (contract multiplier,
    maintenance margin basis) belongs here - scattered "if futures then
    divide by leverage" branches through the rule set are how valuation
    semantics drift. The spot-only platform asserts SPOT and computes
    ``abs(quantity) * reference`` and nothing more imaginative.
    """
    if market_type is not MarketType.SPOT:
        raise NotImplementedError(
            "Exposure valuation for non-spot market types is a deliberately "
            "unimplemented extension point: the interface exists so it is a "
            "bounded change, and refusing here is what keeps anyone from "
            "activating margin exposure by configuration typo."
        )
    references = context.reference_map()
    per_symbol_gross: dict[tuple[str, str], Decimal] = {}
    per_symbol_net: dict[tuple[str, str], Decimal] = {}

    def add(symbol_key: tuple[str, str], gross: Decimal, net: Decimal) -> None:
        per_symbol_gross[symbol_key] = per_symbol_gross.get(symbol_key, _ZERO) + gross
        per_symbol_net[symbol_key] = per_symbol_net.get(symbol_key, _ZERO) + net

    for position in context.positions:
        price = references.get((position.exchange, position.symbol))
        if price is None:
            continue
        add(
            (position.exchange, position.symbol),
            position.gross_notional_at(price),
            position.quantity * price,
        )

    for order in context.open_orders:
        price = references.get((order.exchange, order.symbol))
        if price is None:
            continue
        # Unfilled reservation notional counts at *reference* price, toward
        # the same buckets the resulting position would occupy. Reduce-only
        # reservations do NOT add to gross exposure: they are promised
        # reductions, and counting them would make an account that is
        # actively de-risking look over-limit.
        if order.is_reduce_only:
            continue
        add(
            (order.exchange, order.symbol),
            order.unfilled_quantity * price,
            order.signed_unfilled * price,
        )

    buckets: list[ExposureBucket] = []
    for exchange, symbol in sorted(per_symbol_gross):
        buckets.append(
            ExposureBucket(
                dimension=ExposureDimension.SYMBOL,
                target=symbol,
                gross_notional=per_symbol_gross[(exchange, symbol)],
                net_signed_notional=per_symbol_net.get((exchange, symbol), _ZERO),
                members=(f"{exchange}:{symbol}",),
            )
        )

    # Strategy attribution comes from open orders, because positions do not
    # carry a strategy id: one net position may have been built by several
    # strategies, and inventing an allocation would be the kind of fabricated
    # number this engine refuses everywhere else. The STRATEGY dimension is
    # therefore *reservation* exposure; the gate's strategy ceiling rule
    # applies it to the projection delta of the candidate order (see
    # ``rules.MAX_STRATEGY_EXPOSURE`` for the documented composition).
    per_strategy: dict[str, tuple[Decimal, Decimal, set[str]]] = {}
    for order in sorted(
        context.open_orders, key=lambda o: (o.strategy_id or "", o.symbol, o.client_order_id)
    ):
        if order.strategy_id is None or order.is_reduce_only:
            continue
        price = references.get((order.exchange, order.symbol))
        if price is None:
            continue
        gross = order.unfilled_quantity * price
        total, net, members = per_strategy.get(order.strategy_id, (_ZERO, _ZERO, set()))
        per_strategy[order.strategy_id] = (
            total + gross,
            net + order.signed_unfilled * price,
            members | {order.symbol},
        )
    for strategy_id in sorted(per_strategy):
        total, net, members = per_strategy[strategy_id]
        buckets.append(
            ExposureBucket(
                dimension=ExposureDimension.STRATEGY,
                target=strategy_id,
                gross_notional=total,
                net_signed_notional=net,
                members=tuple(sorted(members)),
            )
        )

    per_exchange: dict[str, tuple[Decimal, Decimal, set[str]]] = {}
    for (exchange, symbol), gross in per_symbol_gross.items():
        total, net, members = per_exchange.get(exchange, (_ZERO, _ZERO, set()))
        per_exchange[exchange] = (
            total + gross,
            net + per_symbol_net.get((exchange, symbol), _ZERO),
            members | {symbol},
        )
    for exchange in sorted(per_exchange):
        total, net, members = per_exchange[exchange]
        buckets.append(
            ExposureBucket(
                dimension=ExposureDimension.EXCHANGE,
                target=exchange,
                gross_notional=total,
                net_signed_notional=net,
                members=tuple(sorted(members)),
            )
        )

    account_gross = sum(per_symbol_gross.values(), _ZERO)
    buckets.append(
        ExposureBucket(
            dimension=ExposureDimension.ACCOUNT,
            target="account",
            gross_notional=account_gross,
            net_signed_notional=sum(per_symbol_net.values(), _ZERO),
            members=tuple(sorted({symbol for _, symbol in per_symbol_gross})),
        )
    )
    return ExposureBreakdown(
        buckets=tuple(buckets),
        account_gross_notional=account_gross,
    )
