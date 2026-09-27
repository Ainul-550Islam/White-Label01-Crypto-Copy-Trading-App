"""Position tracking derived exclusively from real fills.

There is no code path in this module that invents a quantity, a price or a PnL
number. A position only changes when :meth:`PositionManager.apply_fill` is
handed a :class:`~wlct_trading.orders.Fill`, and every field is a pure function
of the fills seen so far. Unrealised PnL additionally requires a mark price
supplied by the caller; when no mark is available it is ``None``, never zero
and never a guess.

Accounting model
----------------
Weighted-average cost. Increasing exposure moves the average entry price;
reducing exposure realises PnL against that average and leaves it unchanged.

A fill large enough to flip the side is split internally into a close of the
whole existing position followed by an open of the remainder at the fill price -
which is the only treatment that keeps realised PnL correct across a flip.

Fees are accumulated separately and subtracted in :attr:`Position.net_pnl` so
gross trading performance and cost drag stay distinguishable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderSide, PositionSide
from wlct_trading.orders import Fill

__all__ = ["Position", "PositionManager", "PositionUpdate"]

_ZERO = Decimal(0)


@dataclass(slots=True)
class Position:
    """Net exposure in one symbol on one account.

    ``quantity`` is signed: positive is long, negative is short, zero is flat.
    A single signed number avoids an entire class of bug that appears when
    side and magnitude are stored separately and drift apart.
    """

    tenant_id: str
    account_id: str
    exchange: ExchangeId
    symbol: str
    quantity: Decimal = _ZERO
    average_entry_price: Decimal | None = None
    realised_pnl: Decimal = _ZERO
    cumulative_fee: Decimal = _ZERO
    fee_currency: str | None = None
    mark_price: Decimal | None = None
    contains_simulated_fills: bool = False
    fill_count: int = 0
    opened_at: int | None = None
    updated_at: int = field(default_factory=epoch_micros)

    @property
    def side(self) -> PositionSide:
        if self.quantity > _ZERO:
            return PositionSide.LONG
        if self.quantity < _ZERO:
            return PositionSide.SHORT
        return PositionSide.FLAT

    @property
    def absolute_quantity(self) -> Decimal:
        return abs(self.quantity)

    @property
    def is_flat(self) -> bool:
        return self.quantity == _ZERO

    @property
    def entry_notional(self) -> Decimal:
        """Absolute cost basis of the open position."""
        if self.average_entry_price is None:
            return _ZERO
        return self.absolute_quantity * self.average_entry_price

    def notional_at(self, price: Decimal) -> Decimal:
        """Absolute exposure valued at ``price``."""
        return self.absolute_quantity * price

    @property
    def unrealised_pnl(self) -> Decimal | None:
        """Mark-to-market PnL, or ``None`` when it cannot be computed.

        Returning ``None`` rather than zero is deliberate: "no mark price
        available" and "position is exactly break-even" are different facts and
        collapsing them would misreport risk.
        """
        if self.is_flat or self.average_entry_price is None or self.mark_price is None:
            return None
        return (self.mark_price - self.average_entry_price) * self.quantity

    @property
    def total_pnl(self) -> Decimal | None:
        """Realised plus unrealised, gross of fees."""
        unrealised = self.unrealised_pnl
        if unrealised is None:
            return self.realised_pnl if self.is_flat else None
        return self.realised_pnl + unrealised

    @property
    def net_pnl(self) -> Decimal | None:
        """Total PnL after fees."""
        total = self.total_pnl
        if total is None:
            return None
        return total - self.cumulative_fee


@dataclass(slots=True, frozen=True)
class PositionUpdate:
    """What one fill did to a position."""

    position: Position
    realised_delta: Decimal
    previous_quantity: Decimal
    new_quantity: Decimal
    flipped: bool
    closed: bool


class PositionManager:
    """Owns the in-memory position set for the execution engine.

    Keyed by ``(account_id, exchange, symbol)`` - deliberately *not* by tenant
    alone, because one tenant may hold several accounts and netting across them
    would be wrong.

    Duplicate fills are the caller's responsibility to filter: ``Order``
    already deduplicates by ``fill_id`` and returns ``False``, so the execution
    engine only forwards fills that were genuinely new.
    """

    __slots__ = ("_positions",)

    def __init__(self) -> None:
        self._positions: dict[tuple[str, str, str], Position] = {}

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------
    @staticmethod
    def _key(account_id: str, exchange: ExchangeId, symbol: str) -> tuple[str, str, str]:
        return (account_id, exchange.value, symbol)

    def get(
        self, account_id: str, exchange: ExchangeId, symbol: str
    ) -> Position | None:
        return self._positions.get(self._key(account_id, exchange, symbol))

    def get_or_create(
        self, tenant_id: str, account_id: str, exchange: ExchangeId, symbol: str
    ) -> Position:
        key = self._key(account_id, exchange, symbol)
        position = self._positions.get(key)
        if position is None:
            position = Position(
                tenant_id=tenant_id,
                account_id=account_id,
                exchange=exchange,
                symbol=symbol,
            )
            self._positions[key] = position
        return position

    def all_for_account(self, account_id: str) -> list[Position]:
        return [p for p in self._positions.values() if p.account_id == account_id]

    def all_for_tenant(self, tenant_id: str) -> list[Position]:
        return [p for p in self._positions.values() if p.tenant_id == tenant_id]

    def open_positions(self) -> list[Position]:
        return [p for p in self._positions.values() if not p.is_flat]

    def account_exposure(
        self, account_id: str, marks: dict[str, Decimal] | None = None
    ) -> Decimal:
        """Total absolute notional across an account.

        Values each position at its mark price when one is known, otherwise at
        its entry price. ``marks`` may override the stored mark per symbol.
        """
        total = _ZERO
        for position in self.all_for_account(account_id):
            if position.is_flat:
                continue
            price = None
            if marks is not None:
                price = marks.get(position.symbol)
            if price is None:
                price = position.mark_price or position.average_entry_price
            if price is None:
                continue
            total += position.notional_at(price)
        return total

    def symbol_exposure(
        self, account_id: str, symbol: str, mark: Decimal | None = None
    ) -> Decimal:
        position = self.get_by_symbol(account_id, symbol)
        if position is None or position.is_flat:
            return _ZERO
        price = mark or position.mark_price or position.average_entry_price
        if price is None:
            return _ZERO
        return position.notional_at(price)

    def get_by_symbol(self, account_id: str, symbol: str) -> Position | None:
        for (acct, _exchange, sym), position in self._positions.items():
            if acct == account_id and sym == symbol:
                return position
        return None

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------
    def set_mark_price(
        self, account_id: str, exchange: ExchangeId, symbol: str, mark: Decimal
    ) -> Position | None:
        """Update the valuation price used for unrealised PnL."""
        position = self.get(account_id, exchange, symbol)
        if position is None:
            return None
        position.mark_price = mark
        position.updated_at = epoch_micros()
        return position

    def apply_fill(
        self,
        tenant_id: str,
        account_id: str,
        exchange: ExchangeId,
        symbol: str,
        side: OrderSide,
        fill: Fill,
    ) -> PositionUpdate:
        """Fold one real fill into the position.

        This is the *only* mutator of quantity, average price and realised PnL.
        """
        if fill.quantity <= _ZERO:
            raise ValueError(f"Fill {fill.fill_id} has non-positive quantity.")

        position = self.get_or_create(tenant_id, account_id, exchange, symbol)
        previous_quantity = position.quantity
        signed_quantity = fill.quantity * side.sign

        realised_delta = _ZERO
        flipped = False

        if position.quantity == _ZERO or position.average_entry_price is None:
            # Opening from flat.
            position.quantity = signed_quantity
            position.average_entry_price = fill.price
            position.opened_at = position.opened_at or fill.received_timestamp
        elif (position.quantity > _ZERO) == (signed_quantity > _ZERO):
            # Same direction: increase exposure, move the weighted average.
            total_cost = (
                position.average_entry_price * position.absolute_quantity
                + fill.price * fill.quantity
            )
            position.quantity = position.quantity + signed_quantity
            position.average_entry_price = total_cost / position.absolute_quantity
        else:
            # Opposite direction: reduce, close, or flip.
            closing_quantity = min(abs(signed_quantity), position.absolute_quantity)
            direction = Decimal(1) if position.quantity > _ZERO else Decimal(-1)
            realised_delta = (
                (fill.price - position.average_entry_price) * closing_quantity * direction
            )
            position.realised_pnl += realised_delta

            remaining = position.quantity + signed_quantity
            if remaining == _ZERO:
                position.quantity = _ZERO
                position.average_entry_price = None
                position.opened_at = None
            elif (remaining > _ZERO) == (position.quantity > _ZERO):
                # Partial reduction; average entry price is unchanged.
                position.quantity = remaining
            else:
                # Flipped through zero: the residual opens a new position at
                # the fill price.
                flipped = True
                position.quantity = remaining
                position.average_entry_price = fill.price
                position.opened_at = fill.received_timestamp

        position.cumulative_fee += fill.fee
        position.fee_currency = fill.fee_currency
        position.fill_count += 1
        position.mark_price = fill.price
        position.updated_at = fill.received_timestamp
        if fill.is_simulated:
            position.contains_simulated_fills = True

        return PositionUpdate(
            position=position,
            realised_delta=realised_delta,
            previous_quantity=previous_quantity,
            new_quantity=position.quantity,
            flipped=flipped,
            closed=position.is_flat and previous_quantity != _ZERO,
        )
