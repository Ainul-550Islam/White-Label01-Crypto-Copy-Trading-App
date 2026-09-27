"""The simulated portfolio.

Every number this class reports is derived from simulated fills. There is no
method that sets an equity, a PnL or a trade count directly, and no path that
produces a performance figure without a fill behind it. That is the whole
design: performance statistics are a *consequence* of the simulated execution,
never an independent calculation of what the strategy "should" have made.

Position and realised-PnL accounting is delegated to the existing
:class:`~wlct_trading.positions.PositionManager` - the same weighted-average
implementation used on the live path - rather than reimplemented here. Two
accounting engines would eventually disagree, and the paper numbers would stop
being evidence about the live path.

What this class adds on top of the position manager is the cash side: balance,
reserved margin for resting orders, fees, slippage cost, the equity curve and
drawdown. All of it is labelled simulated, and
:attr:`SimulatedPortfolio.is_simulated` is a constant ``True``.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.enums import ExchangeId, OrderSide, PositionSide
from wlct_trading.orders import Fill
from wlct_trading.positions import Position, PositionManager, PositionUpdate

__all__ = [
    "PortfolioError",
    "ClosedTrade",
    "EquityPoint",
    "SimulatedPortfolio",
]

_ZERO = Decimal(0)


class PortfolioError(ValueError):
    """Raised when the portfolio is asked to do something incoherent."""


@dataclass(slots=True, frozen=True)
class EquityPoint:
    """One observation of account equity, in simulated time."""

    timestamp_micros: int
    equity: Decimal
    cash: Decimal
    position_quantity: Decimal
    mark_price: Decimal | None

    def to_dict(self) -> dict[str, object]:
        return {
            "timestampMicros": self.timestamp_micros,
            "equity": str(self.equity),
            "cash": str(self.cash),
            "positionQuantity": str(self.position_quantity),
            "markPrice": str(self.mark_price) if self.mark_price is not None else None,
            "isSimulated": True,
        }


@dataclass(slots=True, frozen=True)
class ClosedTrade:
    """A round trip: exposure opened and later reduced or closed.

    One :class:`ClosedTrade` is recorded per *reducing* fill, not per position.
    A position built with three fills and closed with one produces one closed
    trade; a position closed in three fills produces three. That is the
    convention the trade statistics use, and it is stated here because the
    alternative convention would give different win-rate numbers from the same
    data.
    """

    symbol: str
    direction: PositionSide
    quantity: Decimal
    entry_price: Decimal
    exit_price: Decimal
    realised_pnl: Decimal
    fee: Decimal
    opened_at_micros: int | None
    closed_at_micros: int
    is_simulated: bool = True

    @property
    def net_pnl(self) -> Decimal:
        """Realised PnL after the fee charged on the closing fill."""
        return self.realised_pnl - self.fee

    @property
    def is_win(self) -> bool:
        """Wins are measured net of fees. A trade that only made money before
        costs did not make money."""
        return self.net_pnl > _ZERO

    def to_dict(self) -> dict[str, object]:
        return {
            "symbol": self.symbol,
            "direction": self.direction.value,
            "quantity": str(self.quantity),
            "entryPrice": str(self.entry_price),
            "exitPrice": str(self.exit_price),
            "realisedPnl": str(self.realised_pnl),
            "fee": str(self.fee),
            "netPnl": str(self.net_pnl),
            "openedAtMicros": self.opened_at_micros,
            "closedAtMicros": self.closed_at_micros,
            "isSimulated": True,
        }


class SimulatedPortfolio:
    """Cash, exposure, costs and the equity curve for one simulated account."""

    __slots__ = (
        "_initial_cash",
        "_cash",
        "_reserved",
        "_quote_asset",
        "_base_asset",
        "_tenant_id",
        "_account_id",
        "_exchange",
        "_symbol",
        "_positions",
        "_fees_paid",
        "_slippage_cost",
        "_fill_count",
        "_buy_quantity",
        "_sell_quantity",
        "_turnover",
        "_closed_trades",
        "_equity_curve",
        "_peak_equity",
        "_max_drawdown",
        "_max_drawdown_fraction",
        "_exposed_observations",
        "_total_observations",
    )

    def __init__(
        self,
        *,
        initial_cash: Decimal,
        tenant_id: str,
        account_id: str,
        exchange: ExchangeId,
        symbol: str,
        quote_asset: str = "USDT",
        base_asset: str = "BTC",
    ) -> None:
        if not isinstance(initial_cash, Decimal):
            raise PortfolioError("initial_cash must be a Decimal.")
        if initial_cash <= _ZERO:
            raise PortfolioError("initial_cash must be positive.")

        self._initial_cash = initial_cash
        self._cash = initial_cash
        self._reserved = _ZERO
        self._quote_asset = quote_asset
        self._base_asset = base_asset
        self._tenant_id = tenant_id
        self._account_id = account_id
        self._exchange = exchange
        self._symbol = symbol
        self._positions = PositionManager()
        self._fees_paid = _ZERO
        self._slippage_cost = _ZERO
        self._fill_count = 0
        self._buy_quantity = _ZERO
        self._sell_quantity = _ZERO
        self._turnover = _ZERO
        self._closed_trades: list[ClosedTrade] = []
        self._equity_curve: list[EquityPoint] = []
        self._peak_equity = initial_cash
        self._max_drawdown = _ZERO
        self._max_drawdown_fraction: Decimal | None = None
        self._exposed_observations = 0
        self._total_observations = 0

    # -- identity ----------------------------------------------------------
    @property
    def is_simulated(self) -> bool:
        """Always ``True``. Every figure here derives from simulated fills."""
        return True

    @property
    def symbol(self) -> str:
        return self._symbol

    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    @property
    def positions(self) -> PositionManager:
        return self._positions

    # -- balances -----------------------------------------------------------
    @property
    def initial_cash(self) -> Decimal:
        return self._initial_cash

    @property
    def cash(self) -> Decimal:
        return self._cash

    @property
    def reserved(self) -> Decimal:
        return self._reserved

    @property
    def available_cash(self) -> Decimal:
        return self._cash - self._reserved

    @property
    def base_quantity(self) -> Decimal:
        position = self.position
        return position.quantity if position is not None else _ZERO

    @property
    def position(self) -> Position | None:
        return self._positions.get(self._account_id, self._exchange, self._symbol)

    # -- costs ---------------------------------------------------------------
    @property
    def fees_paid(self) -> Decimal:
        return self._fees_paid

    @property
    def slippage_cost(self) -> Decimal:
        return self._slippage_cost

    @property
    def fill_count(self) -> int:
        return self._fill_count

    @property
    def turnover(self) -> Decimal:
        """Total traded notional, both directions."""
        return self._turnover

    # -- PnL -------------------------------------------------------------------
    @property
    def realised_pnl(self) -> Decimal:
        position = self.position
        return position.realised_pnl if position is not None else _ZERO

    @property
    def unrealised_pnl(self) -> Decimal | None:
        """``None`` when flat or when no mark price is available.

        Deliberately not zero: "no mark" and "break even" are different facts
        and collapsing them would misreport risk.
        """
        position = self.position
        if position is None:
            return None
        return position.unrealised_pnl

    @property
    def net_pnl(self) -> Decimal:
        """Realised PnL less fees. Excludes unrealised by construction.

        A net figure that silently included an unrealised mark would change
        whenever the last price moved, which is not what "net PnL" should mean
        in a trade report.
        """
        return self.realised_pnl - self._fees_paid

    def equity(self, mark_price: Decimal | None) -> Decimal:
        """Cash plus the marked value of the position.

        With no mark price the position is valued at its cost basis rather than
        dropped, so equity does not jump when a mark becomes unavailable. The
        equity point records that the mark was absent.
        """
        position = self.position
        if position is None or position.is_flat:
            return self._cash
        if mark_price is not None:
            return self._cash + position.quantity * mark_price
        if position.average_entry_price is not None:
            return self._cash + position.quantity * position.average_entry_price
        return self._cash

    # -- mutation ---------------------------------------------------------------
    def reserve(self, amount: Decimal) -> None:
        """Set aside cash for a resting order."""
        if amount < _ZERO:
            raise PortfolioError("Cannot reserve a negative amount.")
        self._reserved += amount

    def release(self, amount: Decimal) -> None:
        """Release previously reserved cash. Clamped at zero."""
        if amount < _ZERO:
            raise PortfolioError("Cannot release a negative amount.")
        self._reserved = self._reserved - amount
        if self._reserved < _ZERO:
            self._reserved = _ZERO

    def apply_fill(
        self, fill: Fill, *, slippage_cost: Decimal = _ZERO
    ) -> PositionUpdate:
        """Apply one simulated fill to cash, position and cost tallies.

        Refuses a fill that is not marked simulated. A real fill reaching a
        simulated portfolio would mean the two paths had been crossed
        somewhere, and continuing would produce a report mixing real and
        imaginary money.
        """
        if not fill.is_simulated:
            raise PortfolioError(
                "SimulatedPortfolio refuses a fill that is not marked simulated."
            )
        if fill.side is None:
            raise PortfolioError("A simulated fill must carry its side.")
        if fill.symbol is not None and fill.symbol != self._symbol:
            raise PortfolioError(
                f"Fill is for {fill.symbol} but this portfolio holds "
                f"{self._symbol}."
            )

        position_before = self.position
        entry_before = (
            position_before.average_entry_price if position_before is not None else None
        )
        opened_at = position_before.opened_at if position_before is not None else None

        notional = fill.price * fill.quantity
        if fill.side is OrderSide.BUY:
            self._cash -= notional + fill.fee
            self._buy_quantity += fill.quantity
        else:
            self._cash += notional - fill.fee
            self._sell_quantity += fill.quantity

        self._fees_paid += fill.fee
        self._slippage_cost += slippage_cost
        self._turnover += notional
        self._fill_count += 1

        update = self._positions.apply_fill(
            self._tenant_id,
            self._account_id,
            self._exchange,
            self._symbol,
            fill.side,
            fill,
        )

        reduced = (
            entry_before is not None
            and update.previous_quantity != _ZERO
            and (
                abs(update.new_quantity) < abs(update.previous_quantity)
                or update.flipped
                or update.closed
            )
        )
        if reduced and entry_before is not None:
            # Recorded on any exposure-reducing fill, including one that
            # realises exactly zero: a flat round trip still cost the fees, and
            # omitting it would quietly improve the win rate.
            direction = (
                PositionSide.LONG if update.previous_quantity > _ZERO else PositionSide.SHORT
            )
            closed_quantity = abs(update.previous_quantity) - abs(update.new_quantity)
            if closed_quantity < _ZERO:
                closed_quantity = abs(update.previous_quantity)
            self._closed_trades.append(
                ClosedTrade(
                    symbol=self._symbol,
                    direction=direction,
                    quantity=closed_quantity,
                    entry_price=entry_before,
                    exit_price=fill.price,
                    realised_pnl=update.realised_delta,
                    fee=fill.fee,
                    opened_at_micros=opened_at,
                    closed_at_micros=fill.exchange_timestamp,
                )
            )

        return update

    def mark_to_market(
        self, *, timestamp_micros: int, mark_price: Decimal | None
    ) -> EquityPoint:
        """Record one equity observation and update the drawdown tallies."""
        if mark_price is not None:
            self._positions.set_mark_price(
                self._account_id, self._exchange, self._symbol, mark_price
            )
        equity = self.equity(mark_price)
        position_quantity = self.base_quantity

        point = EquityPoint(
            timestamp_micros=timestamp_micros,
            equity=equity,
            cash=self._cash,
            position_quantity=position_quantity,
            mark_price=mark_price,
        )
        self._equity_curve.append(point)

        self._total_observations += 1
        if position_quantity != _ZERO:
            self._exposed_observations += 1

        if equity > self._peak_equity:
            self._peak_equity = equity
        decline = self._peak_equity - equity
        if decline > self._max_drawdown:
            self._max_drawdown = decline
            self._max_drawdown_fraction = (
                decline / self._peak_equity if self._peak_equity > _ZERO else None
            )

        return point

    # -- reporting ---------------------------------------------------------------
    @property
    def equity_curve(self) -> tuple[EquityPoint, ...]:
        return tuple(self._equity_curve)

    @property
    def equity_values(self) -> tuple[Decimal, ...]:
        return tuple(point.equity for point in self._equity_curve)

    @property
    def closed_trades(self) -> tuple[ClosedTrade, ...]:
        return tuple(self._closed_trades)

    @property
    def peak_equity(self) -> Decimal:
        return self._peak_equity

    @property
    def max_drawdown(self) -> Decimal:
        return self._max_drawdown

    @property
    def max_drawdown_fraction(self) -> Decimal | None:
        return self._max_drawdown_fraction

    @property
    def final_equity(self) -> Decimal:
        if self._equity_curve:
            return self._equity_curve[-1].equity
        return self._cash

    @property
    def exposure_fraction(self) -> Decimal | None:
        """Share of observations during which a position was held.

        ``None`` before any observation exists - a fraction of nothing is not
        zero exposure, it is an unanswered question.
        """
        if self._total_observations == 0:
            return None
        return Decimal(self._exposed_observations) / Decimal(self._total_observations)

    def to_dict(self) -> dict[str, object]:
        unrealised = self.unrealised_pnl
        return {
            "isSimulated": True,
            "quoteAsset": self._quote_asset,
            "baseAsset": self._base_asset,
            "initialCash": str(self._initial_cash),
            "cash": str(self._cash),
            "reserved": str(self._reserved),
            "positionQuantity": str(self.base_quantity),
            "realisedPnl": str(self.realised_pnl),
            "unrealisedPnl": str(unrealised) if unrealised is not None else None,
            "netPnl": str(self.net_pnl),
            "feesPaid": str(self._fees_paid),
            "slippageCost": str(self._slippage_cost),
            "turnover": str(self._turnover),
            "fillCount": self._fill_count,
            "closedTradeCount": len(self._closed_trades),
            "finalEquity": str(self.final_equity),
            "peakEquity": str(self._peak_equity),
            "maxDrawdown": str(self._max_drawdown),
            "maxDrawdownFraction": (
                str(self._max_drawdown_fraction)
                if self._max_drawdown_fraction is not None
                else None
            ),
            "exposureFraction": (
                str(self.exposure_fraction)
                if self.exposure_fraction is not None
                else None
            ),
        }
