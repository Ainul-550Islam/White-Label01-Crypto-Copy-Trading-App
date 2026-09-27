"""The normalised backtest result and its configuration hash.

A result is only useful if somebody can reproduce it. That requires knowing
four things exactly: which implementation ran, with which parameters, under
which execution assumptions, over which data. :func:`compute_configuration_hash`
folds all four into one hex digest, and :class:`BacktestResult` records the
components alongside it so an operator can see *why* two hashes differ rather
than only that they do.

The hash never includes a secret. Strategy parameters are validated by
:class:`~wlct_trading.strategies.parameters.ParameterSchema`, which refuses
credential-shaped names outright, and nothing else fed into the hash comes from
a credential store.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Mapping, Sequence

from wlct_trading.backtest.dataset import DatasetDescriptor
from wlct_trading.backtest.metrics import PerformanceMetrics
from wlct_trading.backtest.portfolio import ClosedTrade, EquityPoint
from wlct_trading.backtest.simulator import ExecutionAssumptions
from wlct_trading.enums import BacktestPhase, ExchangeId

__all__ = [
    "BACKTEST_DISCLAIMER",
    "compute_configuration_hash",
    "BacktestResult",
]

#: Attached to every result. Not decoration - a backtest number shown without
#: this context invites exactly the wrong conclusion.
BACKTEST_DISCLAIMER = (
    "Simulated result. Backtest performance is not indicative of future "
    "performance, does not account for every real-world cost or constraint, "
    "and does not guarantee live execution quality. No profitability claim is "
    "made for any strategy in this system."
)

_ZERO = Decimal(0)


def compute_configuration_hash(
    *,
    strategy_key: str,
    strategy_version: str,
    implementation_id: str,
    parameters: Sequence[tuple[str, str]],
    assumptions: ExecutionAssumptions,
    dataset: DatasetDescriptor,
    initial_capital: Decimal,
) -> str:
    """Deterministic SHA-256 over everything that defines a run.

    Inputs are canonicalised before hashing - parameters sorted by name,
    decimals stringified exactly, enums by wire value - so the digest depends
    on the configuration and on nothing else. Two runs with the same digest
    used the same code, the same settings and the same data.
    """
    digest = hashlib.sha256()
    fields: list[tuple[str, str]] = [
        ("strategy_key", strategy_key),
        ("strategy_version", strategy_version),
        ("implementation_id", implementation_id),
        ("initial_capital", str(initial_capital)),
    ]
    fields.extend(("param." + name, value) for name, value in parameters)
    fields.extend(("assumption." + name, value) for name, value in assumptions.canonical_form())
    fields.extend(("dataset." + name, value) for name, value in dataset.canonical_form())

    for name, value in fields:
        digest.update(name.encode("utf-8"))
        digest.update(b"=")
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


@dataclass(slots=True, frozen=True)
class BacktestResult:
    """Everything one backtest produced, in a form that can be persisted.

    ``is_reproducible`` is not cosmetic: a run over a dataset with no checksum
    cannot be re-verified, and the flag says so rather than letting the numbers
    imply a rigour they do not have.
    """

    run_id: str
    strategy_key: str
    strategy_version: str
    implementation_id: str
    tenant_id: str
    exchange: ExchangeId
    symbol: str
    phase: BacktestPhase
    started_at_micros: int
    ended_at_micros: int
    initial_capital: Decimal
    configuration_hash: str
    parameters: tuple[tuple[str, str], ...]
    assumptions: ExecutionAssumptions
    dataset: DatasetDescriptor
    metrics: PerformanceMetrics
    closed_trades: tuple[ClosedTrade, ...] = field(default_factory=tuple)
    equity_curve: tuple[EquityPoint, ...] = field(default_factory=tuple)
    signals_generated: int = 0
    signals_accepted: int = 0
    signals_rejected: int = 0
    risk_rejections: int = 0
    simulated_orders: int = 0
    simulated_fills: int = 0
    events_replayed: int = 0
    strategy_errors: int = 0
    wall_clock_duration_micros: int = 0
    #: Rejection reasons, counted. Lets an operator see that a run produced no
    #: trades because risk refused everything rather than because the strategy
    #: was silent.
    rejection_counts: tuple[tuple[str, int], ...] = field(default_factory=tuple)

    @property
    def is_simulated(self) -> bool:
        """Always ``True``. This object can only describe a simulation."""
        return True

    @property
    def is_reproducible(self) -> bool:
        return self.dataset.is_reproducible and bool(self.configuration_hash)

    @property
    def duration_micros(self) -> int:
        return self.ended_at_micros - self.started_at_micros

    @property
    def final_equity(self) -> Decimal:
        return self.metrics.final_equity

    @property
    def net_pnl(self) -> Decimal:
        return self.metrics.net_pnl

    def matches(self, other: "BacktestResult") -> bool:
        """Whether two runs were the same experiment with the same outcome.

        Used by the reproducibility test. Compares the configuration hash, the
        headline figures and the trade-by-trade record - identical inputs must
        produce an identical record, not merely a similar summary.
        """
        return (
            self.configuration_hash == other.configuration_hash
            and self.metrics.final_equity == other.metrics.final_equity
            and self.metrics.net_pnl == other.metrics.net_pnl
            and self.metrics.trade_count == other.metrics.trade_count
            and self.metrics.max_drawdown == other.metrics.max_drawdown
            and [trade.to_dict() for trade in self.closed_trades]
            == [trade.to_dict() for trade in other.closed_trades]
            and [point.to_dict() for point in self.equity_curve]
            == [point.to_dict() for point in other.equity_curve]
        )

    def to_dict(self, *, include_curve: bool = False) -> dict[str, object]:
        payload: dict[str, object] = {
            "runId": self.run_id,
            "isSimulated": True,
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "implementationId": self.implementation_id,
            "tenantId": self.tenant_id,
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "phase": self.phase.value,
            "startedAtMicros": self.started_at_micros,
            "endedAtMicros": self.ended_at_micros,
            "durationMicros": self.duration_micros,
            "initialCapital": str(self.initial_capital),
            "configurationHash": self.configuration_hash,
            "parameters": {name: value for name, value in self.parameters},
            "assumptions": self.assumptions.to_dict(),
            "dataset": self.dataset.to_dict(),
            "metrics": self.metrics.to_dict(),
            "signalsGenerated": self.signals_generated,
            "signalsAccepted": self.signals_accepted,
            "signalsRejected": self.signals_rejected,
            "riskRejections": self.risk_rejections,
            "simulatedOrders": self.simulated_orders,
            "simulatedFills": self.simulated_fills,
            "eventsReplayed": self.events_replayed,
            "strategyErrors": self.strategy_errors,
            "rejectionCounts": {name: count for name, count in self.rejection_counts},
            "closedTrades": [trade.to_dict() for trade in self.closed_trades],
            "isReproducible": self.is_reproducible,
            "disclaimer": BACKTEST_DISCLAIMER,
        }
        if include_curve:
            payload["equityCurve"] = [point.to_dict() for point in self.equity_curve]
        return payload

    def operational_dict(self) -> dict[str, object]:
        """The result plus measurements of *this process*, not of the market.

        ``wallClockDurationMicros`` is deliberately absent from
        :meth:`to_dict`: it changes between two otherwise identical runs, and
        including it would break a byte-comparison of two reproductions. It is
        still worth recording, so it lives here.
        """
        payload = self.to_dict()
        payload["wallClockDurationMicros"] = self.wall_clock_duration_micros
        return payload

    def summary_lines(self) -> list[str]:
        """Operator-readable summary. Always ends with the disclaimer."""
        metrics = self.metrics
        return [
            f"Backtest {self.run_id} [SIMULATED]",
            f"  strategy        {self.strategy_key}@{self.strategy_version}",
            f"  implementation  {self.implementation_id}",
            f"  symbol          {self.symbol} on {self.exchange.value}",
            f"  dataset         {self.dataset.dataset_id} "
            f"({self.dataset.event_count} events, "
            f"checksum {self.dataset.checksum[:12] if self.dataset.checksum else 'none'})",
            f"  config hash     {self.configuration_hash[:16]}",
            f"  initial capital {self.initial_capital}",
            f"  final equity    {metrics.final_equity}",
            f"  net PnL         {metrics.net_pnl} (fees {metrics.fees}, "
            f"slippage {metrics.slippage_cost})",
            f"  trades          {metrics.trade_count} "
            f"(win {metrics.winning_trades} / loss {metrics.losing_trades})",
            f"  max drawdown    {metrics.max_drawdown}",
            f"  sharpe          "
            f"{metrics.sharpe_ratio if metrics.sharpe_ratio is not None else 'n/a (insufficient observations)'}",
            f"  reproducible    {self.is_reproducible}",
            f"  {BACKTEST_DISCLAIMER}",
        ]


def parameters_to_canonical(parameters: Mapping[str, object]) -> tuple[tuple[str, str], ...]:
    """Sorted ``(name, str(value))`` pairs. Shared by the engine and the hash."""
    return tuple(
        (name, "null" if parameters[name] is None else str(parameters[name]))
        for name in sorted(parameters)
    )
