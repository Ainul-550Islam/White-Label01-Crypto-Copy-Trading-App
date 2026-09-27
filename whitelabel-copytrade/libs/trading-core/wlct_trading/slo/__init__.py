"""Part 10 SLO package: service-level objectives, error budgets, burn-rate
alerting - deterministic arithmetic, no I/O, no trading-path knowledge.

The two rules that define what this package may be used for, stated where
every import site will trip over them:

1. It EVALUATES observability evidence. It never authorises an order, never
   releases a switch, and never releases a reservation - the SLO modules
   import nothing from the execution, risk, or adapter packages, and the
   trading modules must never import this package for a decision (the Part 10
   boundary test enforces both directions).
2. Absent or incomplete evidence evaluates to UNKNOWN, and UNKNOWN is
   neither HEALTHY nor a breach. There is no code path in this package that
   can turn a telemetry gap into a success, because an SLO that counts
   blindness as health is worse than no SLO at all - it launders an outage
   into a green dot.

Public surface:

* :mod:`~wlct_trading.slo.model` - definitions, indicator/state enums,
  canonical checksum;
* :mod:`~wlct_trading.slo.budget` - integer-ppm error-budget arithmetic;
* :mod:`~wlct_trading.slo.burn` - multi-window burn-rate alert conditions;
* :mod:`~wlct_trading.slo.evaluate` - the evaluator itself;
* :mod:`~wlct_trading.slo.catalog` - the default nine-objective catalog.
"""

from __future__ import annotations

from .budget import ErrorBudget, compute_budget, validate_counts
from .burn import BurnAlertKind, BurnAlertState, evaluate_burn
from .catalog import DEFAULT_SLO_CATALOG, default_definitions
from .evaluate import SloEvaluation, SloWindowSample, evaluate_slo
from .model import (
    COUNT_INDICATORS,
    FRESHNESS_INDICATORS,
    MAX_WINDOW_MINUTES,
    MIN_WINDOW_MINUTES,
    SloDefinition,
    SloIndicator,
    SloState,
    SloWindowKind,
    canonical_slo_json,
    objective_to_ppm,
    slo_checksum,
)

__all__ = [
    "COUNT_INDICATORS",
    "FRESHNESS_INDICATORS",
    "MIN_WINDOW_MINUTES",
    "MAX_WINDOW_MINUTES",
    "SloDefinition",
    "SloIndicator",
    "SloState",
    "SloWindowKind",
    "objective_to_ppm",
    "canonical_slo_json",
    "slo_checksum",
    "ErrorBudget",
    "compute_budget",
    "validate_counts",
    "BurnAlertKind",
    "BurnAlertState",
    "evaluate_burn",
    "SloWindowSample",
    "SloEvaluation",
    "evaluate_slo",
    "DEFAULT_SLO_CATALOG",
    "default_definitions",
]
