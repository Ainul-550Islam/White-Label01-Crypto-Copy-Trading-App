"""The simulated matching engine: the single implementation of "how a
simulated order fills".

There is exactly one set of fill rules in this project and it lives here. The
Part 2 :class:`~wlct_trading.adapters.paper.PaperTradingAdapter` delegates to
this engine rather than carrying a second copy, so a fill produced during a
backtest and a fill produced during live-data paper trading come from the same
code.

Honesty rules, enforced structurally:

* Every :class:`~wlct_trading.orders.Fill` this engine produces has
  ``is_simulated=True``. There is no code path that can clear that flag, and it
  is carried into the position manager, the database and the API.
* Fills are only ever produced against an **observed** price. If no usable book
  is supplied the order rests unfilled; the engine never invents a price.
* Fees and slippage are explicit inputs, recorded per fill, and never netted
  away into the fill price silently.

**This simulator does not reproduce a real exchange.** It has no queue model,
no order-book impact, no partial-fill microstructure beyond the displayed size
cap, no venue-side latency variance and no rejection modelling. Results
obtained here are an upper bound on execution quality, usually an optimistic
one. Nothing about a simulated result implies a live result.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.enums import (
    ExchangeId,
    LimitFillRule,
    MarketFillPriceModel,
    OrderSide,
    OrderStatus,
    OrderType,
)
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Fill, OrderIntent

__all__ = [
    "ExecutionAssumptions",
    "SimulatedMatch",
    "SimulatedFillEvent",
    "SimulatedIdFactory",
    "SimulatedMatchingEngine",
]

_ZERO = Decimal(0)
_ONE = Decimal(1)
_BPS = Decimal(10_000)


@dataclass(slots=True, frozen=True)
class ExecutionAssumptions:
    """Every assumption the simulator makes, in one hashable object.

    This object is part of the backtest configuration hash. Two runs that
    differ in any field here are different experiments and will not be
    confused with one another.

    Fees are **rates**, not basis points, to match the venue convention used
    elsewhere in the project: ``0.001`` is ten basis points. Slippage is in
    basis points because that is how execution desks discuss it, and mixing the
    two units in one object with clear names is less error-prone than picking
    one and forcing awkward numbers.
    """

    maker_fee_rate: Decimal = Decimal("0.001")
    taker_fee_rate: Decimal = Decimal("0.001")
    slippage_bps: Decimal = _ZERO
    fee_currency: str = "USDT"
    #: Simulated delay between submission and the order becoming executable.
    #: A non-zero value means an order cannot fill against the book that was
    #: current when it was sent - which is the single most flattering
    #: assumption a naive backtest makes.
    latency_micros: int = 0
    allow_partial_fills: bool = True
    #: Fills are capped by the displayed size at the touch. Turning this off
    #: assumes unlimited depth and will overstate achievable size.
    cap_by_displayed_size: bool = True
    #: Fills smaller than this are not produced at all; the remainder rests.
    min_fill_quantity: Decimal = _ZERO
    market_price_model: MarketFillPriceModel = MarketFillPriceModel.TOUCH
    limit_fill_rule: LimitFillRule = LimitFillRule.TOUCH_OR_BETTER

    def __post_init__(self) -> None:
        for name in ("maker_fee_rate", "taker_fee_rate", "slippage_bps"):
            value = getattr(self, name)
            if not isinstance(value, Decimal):
                raise TypeError(f"ExecutionAssumptions.{name} must be a Decimal.")
            if not value.is_finite() or value < _ZERO:
                raise ValueError(
                    f"ExecutionAssumptions.{name} must be finite and non-negative."
                )
        if self.maker_fee_rate > _ONE or self.taker_fee_rate > _ONE:
            raise ValueError("Fee rates are rates, not percentages; 0.001 is 10 bps.")
        if self.latency_micros < 0:
            raise ValueError("ExecutionAssumptions.latency_micros must not be negative.")
        if self.min_fill_quantity < _ZERO:
            raise ValueError(
                "ExecutionAssumptions.min_fill_quantity must not be negative."
            )
        if not self.fee_currency:
            raise ValueError("ExecutionAssumptions.fee_currency is required.")

    def canonical_form(self) -> tuple[tuple[str, str], ...]:
        """Deterministic key/value pairs for the configuration hash."""
        return (
            ("maker_fee_rate", str(self.maker_fee_rate)),
            ("taker_fee_rate", str(self.taker_fee_rate)),
            ("slippage_bps", str(self.slippage_bps)),
            ("fee_currency", self.fee_currency),
            ("latency_micros", str(self.latency_micros)),
            ("allow_partial_fills", "1" if self.allow_partial_fills else "0"),
            ("cap_by_displayed_size", "1" if self.cap_by_displayed_size else "0"),
            ("min_fill_quantity", str(self.min_fill_quantity)),
            ("market_price_model", self.market_price_model.value),
            ("limit_fill_rule", self.limit_fill_rule.value),
        )

    def to_dict(self) -> dict[str, object]:
        return {name: value for name, value in self.canonical_form()}


@dataclass(slots=True, frozen=True)
class SimulatedMatch:
    """Outcome of submitting one order to the simulator."""

    accepted: bool
    status: OrderStatus
    fills: tuple[Fill, ...] = field(default_factory=tuple)
    rests: bool = False
    reason: str | None = None
    slippage_cost: Decimal = _ZERO

    @property
    def filled_quantity(self) -> Decimal:
        return sum((fill.quantity for fill in self.fills), _ZERO)

    @property
    def is_simulated(self) -> bool:
        """Always true. Kept as a property so callers can assert on it."""
        return True


@dataclass(slots=True, frozen=True)
class SimulatedFillEvent:
    """A fill produced later, when a resting order became executable."""

    order_id: str
    client_order_id: str
    fill: Fill
    status: OrderStatus
    slippage_cost: Decimal = _ZERO


class SimulatedIdFactory:
    """Deterministic id source.

    A backtest that used ``uuid4`` would produce different fill ids on every
    run and could never be byte-compared. This factory emits a monotonically
    numbered sequence from a fixed prefix, so the same replay produces the same
    ids. The paper adapter, which has no reproducibility requirement, keeps
    using random ids by passing ``deterministic=False``.
    """

    __slots__ = ("_prefix", "_counter", "_deterministic")

    def __init__(self, prefix: str = "sim", *, deterministic: bool = True) -> None:
        self._prefix = prefix
        self._counter = 0
        self._deterministic = deterministic

    def next_id(self, kind: str) -> str:
        self._counter += 1
        if self._deterministic:
            return f"{self._prefix}-{kind}-{self._counter:012d}"
        return f"{self._prefix}-{kind}-{uuid.uuid4().hex[:16]}"

    def reset(self) -> None:
        self._counter = 0

    @property
    def issued(self) -> int:
        return self._counter


@dataclass(slots=True)
class _RestingOrder:
    """One order waiting for the market to come to it."""

    order_id: str
    client_order_id: str
    intent: OrderIntent
    remaining: Decimal
    activate_at_micros: int
    filled_quantity: Decimal = _ZERO


class SimulatedMatchingEngine:
    """Matches order intents against observed top-of-book data.

    Stateful only in the resting-order book. One engine belongs to one
    simulated account; sharing one between accounts would let their resting
    orders interact, which no real venue does across accounts in this way.
    """

    __slots__ = ("_assumptions", "_ids", "_resting", "_exchange")

    def __init__(
        self,
        assumptions: ExecutionAssumptions | None = None,
        *,
        id_factory: SimulatedIdFactory | None = None,
        exchange: ExchangeId = ExchangeId.PAPER,
    ) -> None:
        self._assumptions = assumptions or ExecutionAssumptions()
        self._ids = id_factory or SimulatedIdFactory()
        self._resting: dict[str, _RestingOrder] = {}
        self._exchange = exchange

    # -- inspection ---------------------------------------------------------
    @property
    def assumptions(self) -> ExecutionAssumptions:
        return self._assumptions

    @property
    def resting_count(self) -> int:
        return len(self._resting)

    def resting_order_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._resting))

    def reset(self) -> None:
        self._resting.clear()
        self._ids.reset()

    # -- submission ----------------------------------------------------------
    def submit(
        self,
        intent: OrderIntent,
        *,
        client_order_id: str,
        order_id: str,
        book: BookTop | None,
        now_micros: int,
    ) -> SimulatedMatch:
        """Submit an order to the simulator.

        Returns immediately with whatever it can do against ``book``. An order
        that cannot fill now rests and will be re-examined on every subsequent
        :meth:`on_book_update`.
        """
        errors = intent.validation_errors()
        if errors:
            return SimulatedMatch(
                accepted=False,
                status=OrderStatus.REJECTED,
                reason="; ".join(errors),
            )

        activate_at = now_micros + self._assumptions.latency_micros

        if self._assumptions.latency_micros > 0:
            # With a latency model the order cannot interact with the book that
            # was current when it was sent. Resting it is the honest treatment;
            # filling it against that book is the classic backtest cheat.
            self._rest(intent, order_id, client_order_id, activate_at)
            return SimulatedMatch(
                accepted=True,
                status=OrderStatus.ACKNOWLEDGED,
                rests=True,
                reason="Resting until the simulated latency has elapsed.",
            )

        if book is None:
            self._rest(intent, order_id, client_order_id, activate_at)
            return SimulatedMatch(
                accepted=True,
                status=OrderStatus.ACKNOWLEDGED,
                rests=True,
                reason="No usable market data; the order rests unfilled.",
            )

        fill_price, is_taker = self._resolve_fill_price(intent, book)
        if fill_price is None:
            self._rest(intent, order_id, client_order_id, activate_at)
            return SimulatedMatch(
                accepted=True,
                status=OrderStatus.ACKNOWLEDGED,
                rests=True,
                reason="Not marketable against the observed touch.",
            )

        quantity = self._fillable_quantity(intent.side, intent.quantity, book)
        if quantity <= _ZERO:
            self._rest(intent, order_id, client_order_id, activate_at)
            return SimulatedMatch(
                accepted=True,
                status=OrderStatus.ACKNOWLEDGED,
                rests=True,
                reason="No displayed size available at the touch.",
            )

        executed_price, slippage_cost = self._apply_slippage(
            intent.side, fill_price, quantity, is_taker
        )
        fill = self._build_fill(
            intent=intent,
            order_id=order_id,
            price=executed_price,
            quantity=quantity,
            is_maker=not is_taker,
            book=book,
            now_micros=now_micros,
        )

        if quantity < intent.quantity:
            self._rest(
                intent,
                order_id,
                client_order_id,
                activate_at,
                remaining=intent.quantity - quantity,
                filled=quantity,
            )
            status = OrderStatus.PARTIALLY_FILLED
        else:
            status = OrderStatus.FILLED

        return SimulatedMatch(
            accepted=True,
            status=status,
            fills=(fill,),
            rests=status is OrderStatus.PARTIALLY_FILLED,
            slippage_cost=slippage_cost,
        )

    def cancel(self, client_order_id: str) -> bool:
        """Remove a resting order. Returns whether anything was removed."""
        for order_id, resting in list(self._resting.items()):
            if resting.client_order_id == client_order_id:
                del self._resting[order_id]
                return True
        return False

    # -- resting-order matching -------------------------------------------------
    def on_book_update(
        self, book: BookTop, *, now_micros: int
    ) -> tuple[SimulatedFillEvent, ...]:
        """Re-examine every resting order against a new book.

        Orders are processed in insertion order, which is deterministic. A real
        venue would use price/time priority across the whole book including
        other participants; this engine models only our own orders and makes no
        claim to reproduce queue position.
        """
        if book.is_crossed:
            # A crossed book is corrupt or mid-resync. Filling against it would
            # manufacture free money in a backtest.
            return ()

        events: list[SimulatedFillEvent] = []
        for order_id in list(self._resting):
            resting = self._resting.get(order_id)
            if resting is None:  # pragma: no cover - defensive
                continue
            if now_micros < resting.activate_at_micros:
                continue

            fill_price, is_taker = self._resolve_fill_price(
                resting.intent, book, resting=True
            )
            if fill_price is None:
                continue

            quantity = self._fillable_quantity(
                resting.intent.side, resting.remaining, book
            )
            if quantity <= _ZERO:
                continue

            executed_price, slippage_cost = self._apply_slippage(
                resting.intent.side, fill_price, quantity, is_taker
            )
            fill = self._build_fill(
                intent=resting.intent,
                order_id=resting.order_id,
                price=executed_price,
                quantity=quantity,
                is_maker=not is_taker,
                book=book,
                now_micros=now_micros,
            )

            resting.remaining -= quantity
            resting.filled_quantity += quantity
            status = (
                OrderStatus.FILLED
                if resting.remaining <= _ZERO
                else OrderStatus.PARTIALLY_FILLED
            )
            if resting.remaining <= _ZERO:
                del self._resting[order_id]

            events.append(
                SimulatedFillEvent(
                    order_id=resting.order_id,
                    client_order_id=resting.client_order_id,
                    fill=fill,
                    status=status,
                    slippage_cost=slippage_cost,
                )
            )
        return tuple(events)

    # -- internals ---------------------------------------------------------------
    def _rest(
        self,
        intent: OrderIntent,
        order_id: str,
        client_order_id: str,
        activate_at: int,
        *,
        remaining: Decimal | None = None,
        filled: Decimal = _ZERO,
    ) -> None:
        self._resting[order_id] = _RestingOrder(
            order_id=order_id,
            client_order_id=client_order_id,
            intent=intent,
            remaining=intent.quantity if remaining is None else remaining,
            activate_at_micros=activate_at,
            filled_quantity=filled,
        )

    def _resolve_fill_price(
        self, intent: OrderIntent, book: BookTop, *, resting: bool = False
    ) -> tuple[Decimal | None, bool]:
        """``(price, is_taker)`` or ``(None, False)`` when it would not fill.

        A marketable order lifts the opposite touch and pays the taker fee. A
        resting limit order that the market reaches is treated as a maker fill,
        which is the assumption that most flatters a passive strategy - queue
        position is not modelled, so a real order at the same price might well
        not have traded.
        """
        touch = book.best_ask if intent.side is OrderSide.BUY else book.best_bid
        if touch is None:
            return None, False

        if intent.order_type is OrderType.MARKET:
            if self._assumptions.market_price_model is MarketFillPriceModel.MID:
                mid = book.mid_price
                return (mid, True) if mid is not None else (touch, True)
            return touch, True

        if intent.order_type is OrderType.LIMIT:
            if intent.price is None:
                return None, False
            if intent.side is OrderSide.BUY:
                crosses = (
                    intent.price >= touch
                    if self._assumptions.limit_fill_rule
                    is LimitFillRule.TOUCH_OR_BETTER
                    else intent.price > touch
                )
            else:
                crosses = (
                    intent.price <= touch
                    if self._assumptions.limit_fill_rule
                    is LimitFillRule.TOUCH_OR_BETTER
                    else intent.price < touch
                )
            if not crosses:
                return None, False
            # Price improvement: a marketable limit fills at the touch, never
            # at its own worse limit price.
            return touch, not resting

        # STOP and STOP_LIMIT need trigger monitoring, which this engine does
        # not model. They rest rather than fill on an assumption.
        return None, False

    def _fillable_quantity(
        self, side: OrderSide, requested: Decimal, book: BookTop
    ) -> Decimal:
        available = (
            book.best_ask_quantity if side is OrderSide.BUY else book.best_bid_quantity
        ) or _ZERO

        if not self._assumptions.cap_by_displayed_size or available <= _ZERO:
            # Preserves the Part 2 behaviour: when the venue reports no size at
            # the touch the simulator does not pretend to know better and fills
            # the request in full. Documented rather than silent.
            quantity = requested
        elif self._assumptions.allow_partial_fills:
            quantity = requested if requested <= available else available
        else:
            quantity = requested if requested <= available else _ZERO

        if quantity < self._assumptions.min_fill_quantity:
            return _ZERO
        return quantity

    def _apply_slippage(
        self, side: OrderSide, price: Decimal, quantity: Decimal, is_taker: bool
    ) -> tuple[Decimal, Decimal]:
        """Worsen a taker price by the configured slippage.

        Slippage is applied against us on both sides - a buy pays more, a sell
        receives less - and only to taker fills. A resting order that the
        market came to did not cross a spread, so charging it slippage would
        double-count the cost.
        """
        bps = self._assumptions.slippage_bps
        if bps == _ZERO or not is_taker:
            return price, _ZERO
        adjustment = price * bps / _BPS
        executed = price + adjustment if side is OrderSide.BUY else price - adjustment
        if executed <= _ZERO:
            return price, _ZERO
        return executed, adjustment * quantity

    def _build_fill(
        self,
        *,
        intent: OrderIntent,
        order_id: str,
        price: Decimal,
        quantity: Decimal,
        is_maker: bool,
        book: BookTop,
        now_micros: int,
    ) -> Fill:
        notional = price * quantity
        fee_rate = (
            self._assumptions.maker_fee_rate
            if is_maker
            else self._assumptions.taker_fee_rate
        )
        return Fill(
            fill_id=self._ids.next_id("fill"),
            order_id=order_id,
            trade_id=self._ids.next_id("trade"),
            price=price,
            quantity=quantity,
            fee=notional * fee_rate,
            fee_currency=self._assumptions.fee_currency,
            is_maker=is_maker,
            # Not a parameter and never will be. Everything this engine
            # produces is simulated.
            is_simulated=True,
            exchange_timestamp=book.exchange_timestamp or now_micros,
            received_timestamp=now_micros,
            symbol=intent.symbol,
            side=intent.side,
            exchange=intent.exchange,
            quote_quantity=notional,
            exchange_order_id=None,
        )
