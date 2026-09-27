"""Performance metrics computed from simulated portfolio state.

Every figure here is derived from the equity curve and the closed trades that
the :class:`~wlct_trading.backtest.portfolio.SimulatedPortfolio` recorded. None
of them is estimated, annualised by default, or computed from anything other
than what the simulator actually did.

Assumptions, stated rather than buried:

* **Returns are simple, per equity observation.** One observation is recorded
  per marked event, so "per period" means "per marked event", not per day. Any
  annualisation is the caller's explicit choice via ``periods_per_year``.
* **Wins are measured net of the closing fee.** A trade that was profitable
  before costs and unprofitable after is a loss.
* **Risk-adjusted ratios are withheld below 20 observations.** Two data points
  can be made to produce any Sharpe ratio at all; reporting one would be
  arithmetic without information. Those fields are ``None`` and
  :attr:`PerformanceMetrics.has_sufficient_observations` says why.
* **Drawdown is a property of the observed path**, not a forecast.

Nothing here is a claim about future performance. A positive result is a
statement about one historical sample under one set of execution assumptions,
and nothing more.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Sequence

from wlct_trading.backtest.portfolio import ClosedTrade, EquityPoint
from wlct_trading.strategies.features.rolling import safe_ratio
from wlct_trading.strategies.features.statistics import (
    MIN_RISK_METRIC_OBSERVATIONS,
    max_drawdown,
    profit_factor,
    sharpe_ratio,
    sortino_ratio,
)

__all__ = ["PerformanceMetrics", "compute_performance", "equity_returns"]

_ZERO = Decimal(0)
_HUNDRED = Decimal(100)


def equity_returns(equity_curve: Sequence[EquityPoint]) -> tuple[Decimal, ...]:
    """Per-observation simple returns of the equity curve.

    An observation whose predecessor was zero or negative equity is skipped
    rather than producing an undefined or absurd return.
    """
    returns: list[Decimal] = []
    previous: Decimal | None = None
    for point in equity_curve:
        if previous is not None and previous > _ZERO:
            change = safe_ratio(point.equity - previous, previous)
            if change is not None:
                returns.append(change)
        previous = point.equity
    return tuple(returns)


@dataclass(slots=True, frozen=True)
class PerformanceMetrics:
    """The complete metric set for one simulated run.

    Fields that could not be computed are ``None``. That is a deliberate choice
    over defaulting to zero: a strategy that never traded has no win rate, and
    reporting ``0%`` would look like a hundred losses.
    """

    initial_capital: Decimal
    final_equity: Decimal
    total_return: Decimal | None
    realised_pnl: Decimal
    unrealised_pnl: Decimal | None
    net_pnl: Decimal
    gross_profit: Decimal
    gross_loss: Decimal
    fees: Decimal
    slippage_cost: Decimal
    turnover: Decimal

    trade_count: int
    winning_trades: int
    losing_trades: int
    breakeven_trades: int
    win_rate: Decimal | None
    average_trade: Decimal | None
    average_win: Decimal | None
    average_loss: Decimal | None
    largest_win: Decimal | None
    largest_loss: Decimal | None
    profit_factor: Decimal | None

    max_drawdown: Decimal
    max_drawdown_fraction: Decimal | None
    exposure_fraction: Decimal | None

    observation_count: int
    sharpe_ratio: Decimal | None
    sortino_ratio: Decimal | None
    min_observations_for_ratios: int = MIN_RISK_METRIC_OBSERVATIONS

    @property
    def has_sufficient_observations(self) -> bool:
        """Whether the risk-adjusted ratios were computed at all."""
        return self.observation_count >= self.min_observations_for_ratios

    @property
    def total_return_percent(self) -> Decimal | None:
        if self.total_return is None:
            return None
        return self.total_return * _HUNDRED

    def to_dict(self) -> dict[str, object]:
        def d(value: Decimal | None) -> str | None:
            return str(value) if value is not None else None

        return {
            "initialCapital": str(self.initial_capital),
            "finalEquity": str(self.final_equity),
            "totalReturn": d(self.total_return),
            "totalReturnPercent": d(self.total_return_percent),
            "realisedPnl": str(self.realised_pnl),
            "unrealisedPnl": d(self.unrealised_pnl),
            "netPnl": str(self.net_pnl),
            "grossProfit": str(self.gross_profit),
            "grossLoss": str(self.gross_loss),
            "fees": str(self.fees),
            "slippageCost": str(self.slippage_cost),
            "turnover": str(self.turnover),
            "tradeCount": self.trade_count,
            "winningTrades": self.winning_trades,
            "losingTrades": self.losing_trades,
            "breakevenTrades": self.breakeven_trades,
            "winRate": d(self.win_rate),
            "averageTrade": d(self.average_trade),
            "averageWin": d(self.average_win),
            "averageLoss": d(self.average_loss),
            "largestWin": d(self.largest_win),
            "largestLoss": d(self.largest_loss),
            "profitFactor": d(self.profit_factor),
            "maxDrawdown": str(self.max_drawdown),
            "maxDrawdownFraction": d(self.max_drawdown_fraction),
            "exposureFraction": d(self.exposure_fraction),
            "observationCount": self.observation_count,
            "sharpeRatio": d(self.sharpe_ratio),
            "sortinoRatio": d(self.sortino_ratio),
            "hasSufficientObservations": self.has_sufficient_observations,
            "minObservationsForRatios": self.min_observations_for_ratios,
            "disclaimer": (
                "Simulated results derived from historical data under stated "
                "execution assumptions. Backtest performance is not indicative "
                "of future performance and does not guarantee live execution "
                "quality."
            ),
        }


def compute_performance(
    *,
    initial_capital: Decimal,
    final_equity: Decimal,
    realised_pnl: Decimal,
    unrealised_pnl: Decimal | None,
    fees: Decimal,
    slippage_cost: Decimal,
    turnover: Decimal,
    closed_trades: Sequence[ClosedTrade],
    equity_curve: Sequence[EquityPoint],
    exposure_fraction: Decimal | None,
    periods_per_year: int | None = None,
    min_observations_for_ratios: int = MIN_RISK_METRIC_OBSERVATIONS,
) -> PerformanceMetrics:
    """Compute the full metric set. Pure function of simulator output."""
    wins = [trade for trade in closed_trades if trade.net_pnl > _ZERO]
    losses = [trade for trade in closed_trades if trade.net_pnl < _ZERO]
    breakeven = [trade for trade in closed_trades if trade.net_pnl == _ZERO]

    gross_profit = sum((trade.net_pnl for trade in wins), _ZERO)
    gross_loss = sum((trade.net_pnl for trade in losses), _ZERO)
    trade_count = len(closed_trades)

    total_pnl_from_trades = sum((trade.net_pnl for trade in closed_trades), _ZERO)

    returns = equity_returns(equity_curve)
    equity_values = [point.equity for point in equity_curve]
    drawdown_absolute, drawdown_fraction = max_drawdown(equity_values)

    return PerformanceMetrics(
        initial_capital=initial_capital,
        final_equity=final_equity,
        total_return=safe_ratio(final_equity - initial_capital, initial_capital),
        realised_pnl=realised_pnl,
        unrealised_pnl=unrealised_pnl,
        net_pnl=realised_pnl - fees,
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        fees=fees,
        slippage_cost=slippage_cost,
        turnover=turnover,
        trade_count=trade_count,
        winning_trades=len(wins),
        losing_trades=len(losses),
        breakeven_trades=len(breakeven),
        win_rate=(
            safe_ratio(Decimal(len(wins)), Decimal(trade_count))
            if trade_count > 0
            else None
        ),
        average_trade=(
            safe_ratio(total_pnl_from_trades, Decimal(trade_count))
            if trade_count > 0
            else None
        ),
        average_win=(
            safe_ratio(gross_profit, Decimal(len(wins))) if wins else None
        ),
        average_loss=(
            safe_ratio(gross_loss, Decimal(len(losses))) if losses else None
        ),
        largest_win=max((trade.net_pnl for trade in wins), default=None),
        largest_loss=min((trade.net_pnl for trade in losses), default=None),
        profit_factor=profit_factor(gross_profit, gross_loss),
        max_drawdown=drawdown_absolute,
        max_drawdown_fraction=drawdown_fraction,
        exposure_fraction=exposure_fraction,
        observation_count=len(returns),
        sharpe_ratio=sharpe_ratio(
            returns,
            periods_per_year=periods_per_year,
            min_observations=min_observations_for_ratios,
        ),
        sortino_ratio=sortino_ratio(
            returns,
            periods_per_year=periods_per_year,
            min_observations=min_observations_for_ratios,
        ),
        min_observations_for_ratios=min_observations_for_ratios,
    )
