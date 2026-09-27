"""Deterministic historical replay, simulated execution and backtest results.

This package answers one question honestly: *what would this strategy have
done over this data, under these stated execution assumptions?* It does not
answer what the strategy will earn, and nothing in it should be read as a
performance claim.

Layout::

    clock.py         SimulatedClock - the only source of time in a replay
    dataset.py       MarketEvent, HistoricalDataset, DatasetDescriptor
    replay.py        ReplayEngine - ordered, no-look-ahead event delivery
    simulator.py     SimulatedMatchingEngine - the one set of fill rules
    portfolio.py     SimulatedPortfolio - cash, exposure, costs, equity curve
    metrics.py       PerformanceMetrics computed from simulator output
    result.py        BacktestResult and the configuration hash
    walkforward.py   TRAINING/VALIDATION/TEST windowing (no optimisation)
    engine.py        BacktestEngine - wires all of the above together

Three warnings this package exists to make unavoidable:

* **BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.**
* **PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.**
* **SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.**

The simulator models neither queue position, market impact, venue rejections,
nor variable latency. Its fills are systematically optimistic. Treat a
favourable result as a reason to investigate, never as evidence of profit.
"""

from __future__ import annotations

from wlct_trading.backtest.clock import ClockError, SimulatedClock
from wlct_trading.backtest.dataset import (
    EVENT_KIND_ORDER,
    DatasetDescriptor,
    DatasetError,
    HistoricalDataset,
    MarketEvent,
    compute_dataset_checksum,
)
from wlct_trading.backtest.engine import BacktestConfig, BacktestEngine
from wlct_trading.backtest.metrics import (
    PerformanceMetrics,
    compute_performance,
    equity_returns,
)
from wlct_trading.backtest.portfolio import (
    ClosedTrade,
    EquityPoint,
    PortfolioError,
    SimulatedPortfolio,
)
from wlct_trading.backtest.replay import (
    LookAheadError,
    ReplayCursor,
    ReplayEngine,
    ReplayStats,
)
from wlct_trading.backtest.result import (
    BACKTEST_DISCLAIMER,
    BacktestResult,
    compute_configuration_hash,
    parameters_to_canonical,
)
from wlct_trading.backtest.simulator import (
    ExecutionAssumptions,
    SimulatedFillEvent,
    SimulatedIdFactory,
    SimulatedMatch,
    SimulatedMatchingEngine,
)
from wlct_trading.backtest.walkforward import (
    WalkForwardSplit,
    WalkForwardWindow,
    rolling_windows,
    split_dataset,
)

__all__ = [
    "BACKTEST_DISCLAIMER",
    "BacktestConfig",
    "BacktestEngine",
    "BacktestResult",
    "ClockError",
    "ClosedTrade",
    "compute_configuration_hash",
    "compute_dataset_checksum",
    "compute_performance",
    "DatasetDescriptor",
    "DatasetError",
    "EquityPoint",
    "equity_returns",
    "EVENT_KIND_ORDER",
    "ExecutionAssumptions",
    "HistoricalDataset",
    "LookAheadError",
    "MarketEvent",
    "parameters_to_canonical",
    "PerformanceMetrics",
    "PortfolioError",
    "ReplayCursor",
    "ReplayEngine",
    "ReplayStats",
    "rolling_windows",
    "SimulatedClock",
    "SimulatedFillEvent",
    "SimulatedIdFactory",
    "SimulatedMatch",
    "SimulatedMatchingEngine",
    "SimulatedPortfolio",
    "split_dataset",
    "WalkForwardSplit",
    "WalkForwardWindow",
]
