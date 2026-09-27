"""Paper trading against a live feed.

One module, one class: :class:`~wlct_trading.paper.session.PaperTradingSession`.
It runs the production strategy path - real normalised market data, the real
signal validator, the real risk engine - and substitutes a simulated execution
adapter for a credentialed one.

The session refuses to be constructed with an adapter that is not marked
simulated, and refuses any trading mode other than ``PAPER`` or ``DRY_RUN``.
It carries no credential and has no field that could hold one.

PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE. Simulated fills ignore
queue position, market impact, venue rejections and latency variance.
"""

from __future__ import annotations

from wlct_trading.paper.session import (
    PaperSessionConfig,
    PaperSessionSummary,
    PaperTradingSafetyError,
    PaperTradingSession,
)

__all__ = [
    "PaperSessionConfig",
    "PaperSessionSummary",
    "PaperTradingSafetyError",
    "PaperTradingSession",
]
