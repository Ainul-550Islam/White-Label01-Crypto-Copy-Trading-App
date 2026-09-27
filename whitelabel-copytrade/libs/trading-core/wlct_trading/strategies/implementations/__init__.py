"""Reference strategy implementations shipped with the library.

There is exactly one, and it is a **test fixture with a production-grade
implementation**, not a trading recommendation. See
:mod:`wlct_trading.strategies.implementations.deterministic_example`.
"""

from __future__ import annotations

from wlct_trading.strategies.implementations.deterministic_example import (
    DeterministicImbalanceStrategy,
)

__all__ = ["DeterministicImbalanceStrategy"]
