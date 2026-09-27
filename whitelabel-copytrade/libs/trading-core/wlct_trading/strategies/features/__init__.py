"""Feature calculation for the strategy layer.

Three layers, deliberately separated:

``rolling``
    Bounded, resettable windows and the safe arithmetic helpers every other
    module uses. No market-data types appear here.
``microstructure``
    Pure functions of one normalised market-data object: mid, spread,
    imbalance. Stateless.
``statistics``
    Descriptive statistics used by the performance layer: dispersion,
    risk-adjusted ratios, drawdown.
``engine``
    The stateful per-instance accumulator that ties the three together and
    produces a :class:`FeatureSnapshot`.

Everything is ``Decimal``-based and ``None``-honest: a feature that cannot be
computed is ``None``, never zero and never a non-finite value.
"""

from __future__ import annotations

from wlct_trading.strategies.features.engine import (
    FeatureConfig,
    FeatureEngine,
    FeatureSnapshot,
)
from wlct_trading.strategies.features.microstructure import (
    depth_imbalance,
    mid_price,
    order_book_imbalance,
    spread,
    spread_basis_points,
    spread_percent,
    top_of_book_notional,
    weighted_mid_price,
)
from wlct_trading.strategies.features.rolling import (
    ROLLING_DECIMAL_PRECISION,
    RollingReturns,
    RollingWindow,
    decimal_sqrt,
    safe_ratio,
    sequence_to_window,
)
from wlct_trading.strategies.features.statistics import (
    MIN_RISK_METRIC_OBSERVATIONS,
    annualisation_factor,
    downside_deviation,
    max_drawdown,
    mean,
    profit_factor,
    sharpe_ratio,
    sortino_ratio,
    standard_deviation,
    variance,
)

__all__ = [
    "annualisation_factor",
    "decimal_sqrt",
    "depth_imbalance",
    "downside_deviation",
    "FeatureConfig",
    "FeatureEngine",
    "FeatureSnapshot",
    "max_drawdown",
    "mean",
    "mid_price",
    "MIN_RISK_METRIC_OBSERVATIONS",
    "order_book_imbalance",
    "profit_factor",
    "ROLLING_DECIMAL_PRECISION",
    "RollingReturns",
    "RollingWindow",
    "safe_ratio",
    "sequence_to_window",
    "sharpe_ratio",
    "sortino_ratio",
    "spread",
    "spread_basis_points",
    "spread_percent",
    "standard_deviation",
    "top_of_book_notional",
    "variance",
    "weighted_mid_price",
]
