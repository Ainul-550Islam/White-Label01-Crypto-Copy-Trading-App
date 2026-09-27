"""Order model, lifecycle state machine and fill accounting.

The state machine is the integrity boundary of the OMS. Exchange callbacks
arrive out of order, get redelivered after a reconnect, and occasionally
contradict each other. Rather than trusting each message, every transition goes
through :meth:`Order.transition_to`, which consults an explicit table of legal
edges and refuses anything else.

Three identifiers are tracked per order and each has a distinct job:

``order_id``
    Our internal UUID. The primary key everywhere in our own systems.
``client_order_id``
    Deterministic, venue-visible, unique per account. Sent to the exchange so
    that a retry after a network timeout is recognised as the *same* order
    instead of doubling the position. This is the idempotency key.
``exchange_order_id``
    Whatever the venue assigns. Unknown until the venue acknowledges, so it can
    never be relied on for deduplication at submission time.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    OPEN_ORDER_STATUSES,
    TERMINAL_ORDER_STATUSES,
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)

__all__ = [
    "ORDER_STATE_TRANSITIONS",
    "InvalidOrderTransition",
    "Fill",
    "OrderEvent",
    "Order",
    "OrderIntent",
    "is_legal_transition",
]

_ZERO = Decimal(0)

#: Legal state transitions. Anything absent from this table is rejected.
#:
#: Notes on the less obvious edges:
#: * ``PENDING -> FAILED`` covers a submission that never left our process
#:   (adapter raised, circuit breaker open).
#: * ``SUBMITTED -> PARTIALLY_FILLED``/``FILLED`` exists because some venues
#:   send the first fill before, or instead of, a separate acknowledgement.
#: * ``PARTIALLY_FILLED -> CANCELLED`` is a partially executed order whose
#:   remainder was pulled; the filled quantity stands.
#: * ``CANCEL_REQUESTED -> FILLED`` is the race where the order completes
#:   before the cancel reaches the matching engine.
ORDER_STATE_TRANSITIONS: dict[OrderStatus, frozenset[OrderStatus]] = {
    OrderStatus.PENDING: frozenset(
        {
            OrderStatus.SUBMITTED,
            OrderStatus.REJECTED,
            OrderStatus.FAILED,
            OrderStatus.CANCELLED,
        }
    ),
    OrderStatus.SUBMITTED: frozenset(
        {
            OrderStatus.ACKNOWLEDGED,
            OrderStatus.PARTIALLY_FILLED,
            OrderStatus.FILLED,
            OrderStatus.REJECTED,
            OrderStatus.CANCEL_REQUESTED,
            OrderStatus.CANCELLED,
            OrderStatus.EXPIRED,
            OrderStatus.FAILED,
        }
    ),
    OrderStatus.ACKNOWLEDGED: frozenset(
        {
            OrderStatus.PARTIALLY_FILLED,
            OrderStatus.FILLED,
            OrderStatus.CANCEL_REQUESTED,
            OrderStatus.CANCELLED,
            OrderStatus.REJECTED,
            OrderStatus.EXPIRED,
            OrderStatus.FAILED,
        }
    ),
    OrderStatus.PARTIALLY_FILLED: frozenset(
        {
            OrderStatus.PARTIALLY_FILLED,
            OrderStatus.FILLED,
            OrderStatus.CANCEL_REQUESTED,
            OrderStatus.CANCELLED,
            OrderStatus.EXPIRED,
            OrderStatus.FAILED,
        }
    ),
    OrderStatus.CANCEL_REQUESTED: frozenset(
        {
            OrderStatus.CANCELLED,
            OrderStatus.FILLED,
            OrderStatus.PARTIALLY_FILLED,
            OrderStatus.EXPIRED,
            OrderStatus.FAILED,
        }
    ),
    OrderStatus.FILLED: frozenset(),
    OrderStatus.CANCELLED: frozenset(),
    OrderStatus.REJECTED: frozenset(),
    OrderStatus.EXPIRED: frozenset(),
    OrderStatus.FAILED: frozenset(),
}


def is_legal_transition(current: OrderStatus, target: OrderStatus) -> bool:
    """Whether ``current -> target`` is permitted by the state machine."""
    return target in ORDER_STATE_TRANSITIONS.get(current, frozenset())


class InvalidOrderTransition(Exception):
    """Raised when a caller attempts a transition the state machine forbids."""

    def __init__(self, order_id: str, current: OrderStatus, target: OrderStatus) -> None:
        self.order_id = order_id
        self.current = current
        self.target = target
        super().__init__(
            f"Order {order_id} cannot move from {current.value} to {target.value}."
        )


@dataclass(slots=True, frozen=True)
class Fill:
    """A single execution against an order.

    ``is_simulated`` is not cosmetic: it is carried into the database and the
    API so a paper fill can never be mistaken for a real one in a PnL report.
    """

    fill_id: str
    order_id: str
    trade_id: str
    price: Decimal
    quantity: Decimal
    fee: Decimal
    fee_currency: str
    is_maker: bool
    is_simulated: bool
    exchange_timestamp: int
    received_timestamp: int = field(default_factory=epoch_micros)

    # -- Venue attribution --------------------------------------------
    # Appended with defaults so that every existing construction site keeps
    # working unchanged. They are populated by the authenticated adapters,
    # where the venue supplies them on the execution report, and they let a
    # fill be routed to the position manager without a database lookup to
    # find out which instrument it belongs to.
    symbol: str | None = None
    side: OrderSide | None = None
    exchange: ExchangeId | None = None
    #: Quote-asset amount as the venue computed it. Retained rather than
    #: recomputed because the venue's rounding is authoritative for
    #: settlement, and recomputing price * quantity can disagree in the last
    #: decimal place.
    quote_quantity: Decimal | None = None
    #: The venue's order id, when the execution report carries it. Lets a fill
    #: arriving before the submit response is processed still be matched.
    exchange_order_id: str | None = None

    @property
    def notional(self) -> Decimal:
        """Quote-asset value of this execution.

        Prefers the venue's own figure when it supplied one, because that is
        what actually moved between the accounts.
        """
        if self.quote_quantity is not None:
            return self.quote_quantity
        return self.price * self.quantity

    @property
    def net_quantity_signed(self) -> Decimal:
        """Quantity signed by side: positive for a buy, negative for a sell.

        ``Decimal(0)`` when the side is unknown, which is the honest answer for
        a fill that predates venue attribution rather than a guess that would
        move a position the wrong way.
        """
        if self.side is None:
            return Decimal(0)
        return self.quantity if self.side is OrderSide.BUY else -self.quantity


@dataclass(slots=True, frozen=True)
class OrderEvent:
    """Immutable audit record of one thing that happened to an order."""

    event_id: str
    order_id: str
    previous_status: OrderStatus | None
    status: OrderStatus
    reason: str | None
    occurred_at: int
    payload: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class OrderIntent:
    """A validated request to trade, before it becomes an :class:`Order`.

    Produced by the signal layer, consumed by the risk engine. It carries no
    lifecycle state - it is purely "this is what we would like to do".
    """

    tenant_id: str
    account_id: str
    strategy_id: str | None
    exchange: ExchangeId
    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: Decimal
    price: Decimal | None = None
    stop_price: Decimal | None = None
    time_in_force: TimeInForce = TimeInForce.GTC
    reduce_only: bool = False
    client_order_id: str | None = None
    signal_id: str | None = None
    created_at: int = field(default_factory=epoch_micros)
    #: Free-form annotation carried alongside the order: the copy-trade leader
    #: it mirrors, the rebalance run that produced it, a correlation id.
    #:
    #: Deliberately excluded from the idempotency fingerprint. Two intents that
    #: differ only in metadata are the *same* trade, and hashing this would let
    #: a changed correlation id defeat duplicate detection and submit twice.
    #:
    #: Values are strings so the whole map can be persisted, published on the
    #: event stream and returned by the API without a serialisation step.
    metadata: dict[str, str] = field(default_factory=dict)

    def validation_errors(self) -> list[str]:
        """Structural problems with the intent, independent of risk limits.

        Kept separate from risk evaluation so that a malformed intent is
        reported as a bug in the strategy rather than as a risk breach.
        """
        errors: list[str] = []
        if not self.tenant_id:
            errors.append("tenant_id is required.")
        if not self.account_id:
            errors.append("account_id is required.")
        if not self.symbol:
            errors.append("symbol is required.")
        if self.quantity <= _ZERO:
            errors.append("quantity must be greater than zero.")
        if self.order_type.requires_price:
            if self.price is None:
                errors.append(f"{self.order_type.value} orders require a limit price.")
            elif self.price <= _ZERO:
                errors.append("price must be greater than zero.")
        if self.order_type.requires_stop_price:
            if self.stop_price is None:
                errors.append(f"{self.order_type.value} orders require a stop price.")
            elif self.stop_price <= _ZERO:
                errors.append("stop_price must be greater than zero.")
        if self.order_type is OrderType.MARKET and self.price is not None:
            errors.append("MARKET orders must not carry a limit price.")
        return errors

    @property
    def is_valid(self) -> bool:
        return not self.validation_errors()


@dataclass(slots=True)
class Order:
    """An order and everything we know about its execution.

    Fill accounting is derived, never assigned: ``filled_quantity`` and
    ``average_fill_price`` are recomputed from the recorded fills each time one
    is added. There is no code path that can set a filled quantity that no fill
    supports, which is what keeps reported PnL honest.
    """

    order_id: str
    client_order_id: str
    tenant_id: str
    account_id: str
    strategy_id: str | None
    exchange: ExchangeId
    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: Decimal
    price: Decimal | None = None
    stop_price: Decimal | None = None
    time_in_force: TimeInForce = TimeInForce.GTC
    reduce_only: bool = False
    signal_id: str | None = None
    is_simulated: bool = False

    status: OrderStatus = OrderStatus.PENDING
    exchange_order_id: str | None = None
    filled_quantity: Decimal = _ZERO
    average_fill_price: Decimal | None = None
    cumulative_fee: Decimal = _ZERO
    fee_currency: str | None = None
    rejection_reason: str | None = None

    created_at: int = field(default_factory=epoch_micros)
    updated_at: int = field(default_factory=epoch_micros)
    submitted_at: int | None = None
    terminal_at: int | None = None

    fills: list[Fill] = field(default_factory=list)
    events: list[OrderEvent] = field(default_factory=list)
    _fill_ids: set[str] = field(default_factory=set, repr=False)

    # ------------------------------------------------------------------
    # Derived state
    # ------------------------------------------------------------------
    @property
    def remaining_quantity(self) -> Decimal:
        remaining = self.quantity - self.filled_quantity
        return remaining if remaining > _ZERO else _ZERO

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_ORDER_STATUSES

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_ORDER_STATUSES

    @property
    def filled_notional(self) -> Decimal:
        if self.average_fill_price is None:
            return _ZERO
        return self.average_fill_price * self.filled_quantity

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------
    def transition_to(
        self,
        target: OrderStatus,
        *,
        reason: str | None = None,
        exchange_order_id: str | None = None,
        payload: dict[str, str] | None = None,
        occurred_at: int | None = None,
    ) -> OrderEvent:
        """Move the order to ``target``, recording an audit event.

        Raises :class:`InvalidOrderTransition` if the edge is not in the table.
        Callers that expect to race with redelivered exchange messages should
        use :meth:`try_transition_to` instead of catching this.
        """
        if not is_legal_transition(self.status, target):
            raise InvalidOrderTransition(self.order_id, self.status, target)

        now = epoch_micros() if occurred_at is None else occurred_at
        previous = self.status
        self.status = target
        self.updated_at = now

        if exchange_order_id is not None:
            self.exchange_order_id = exchange_order_id
        if target is OrderStatus.SUBMITTED and self.submitted_at is None:
            self.submitted_at = now
        if target in (OrderStatus.REJECTED, OrderStatus.FAILED) and reason:
            self.rejection_reason = reason
        if target in TERMINAL_ORDER_STATUSES:
            self.terminal_at = now

        event = OrderEvent(
            event_id=str(uuid.uuid4()),
            order_id=self.order_id,
            previous_status=previous,
            status=target,
            reason=reason,
            occurred_at=now,
            payload=dict(payload or {}),
        )
        self.events.append(event)
        return event

    def try_transition_to(
        self,
        target: OrderStatus,
        *,
        reason: str | None = None,
        exchange_order_id: str | None = None,
        payload: dict[str, str] | None = None,
        occurred_at: int | None = None,
    ) -> OrderEvent | None:
        """Non-raising variant. Returns ``None`` if the transition is illegal.

        This is what the exchange-callback handler uses: a venue resending
        ``ACKNOWLEDGED`` after we already recorded ``FILLED`` is noise to be
        dropped, not an error to be surfaced.
        """
        if not is_legal_transition(self.status, target):
            return None
        return self.transition_to(
            target,
            reason=reason,
            exchange_order_id=exchange_order_id,
            payload=payload,
            occurred_at=occurred_at,
        )

    def apply_fill(self, fill: Fill) -> bool:
        """Record a fill and recompute execution state.

        Returns ``False`` if the fill was a duplicate (same ``fill_id``), which
        happens routinely when a user-data stream replays after reconnect.

        The resulting status is derived from the quantities, not from whatever
        the venue labelled the message: if the cumulative filled quantity
        reaches the order quantity the order is ``FILLED``, otherwise
        ``PARTIALLY_FILLED``.
        """
        if fill.fill_id in self._fill_ids:
            return False
        if fill.order_id != self.order_id:
            raise ValueError(
                f"Fill {fill.fill_id} belongs to order {fill.order_id}, not {self.order_id}."
            )
        if fill.quantity <= _ZERO:
            raise ValueError(f"Fill {fill.fill_id} has non-positive quantity.")

        self._fill_ids.add(fill.fill_id)
        self.fills.append(fill)

        # Recompute from scratch: cheap for realistic fill counts and immune to
        # drift from a mis-ordered incremental update.
        total_quantity = _ZERO
        total_notional = _ZERO
        total_fee = _ZERO
        for recorded in self.fills:
            total_quantity += recorded.quantity
            total_notional += recorded.price * recorded.quantity
            total_fee += recorded.fee

        self.filled_quantity = total_quantity
        self.average_fill_price = (
            total_notional / total_quantity if total_quantity > _ZERO else None
        )
        self.cumulative_fee = total_fee
        self.fee_currency = fill.fee_currency
        self.updated_at = fill.received_timestamp
        if fill.is_simulated:
            self.is_simulated = True

        target = (
            OrderStatus.FILLED
            if self.filled_quantity >= self.quantity
            else OrderStatus.PARTIALLY_FILLED
        )
        self.try_transition_to(
            target,
            reason=f"fill:{fill.fill_id}",
            occurred_at=fill.received_timestamp,
        )
        return True

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def from_intent(
        cls,
        intent: OrderIntent,
        *,
        client_order_id: str,
        order_id: str | None = None,
        is_simulated: bool = False,
    ) -> "Order":
        """Materialise an accepted intent into a tracked order."""
        return cls(
            order_id=order_id or str(uuid.uuid4()),
            client_order_id=client_order_id,
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            strategy_id=intent.strategy_id,
            exchange=intent.exchange,
            symbol=intent.symbol,
            side=intent.side,
            order_type=intent.order_type,
            quantity=intent.quantity,
            price=intent.price,
            stop_price=intent.stop_price,
            time_in_force=intent.time_in_force,
            reduce_only=intent.reduce_only,
            signal_id=intent.signal_id,
            is_simulated=is_simulated,
        )
