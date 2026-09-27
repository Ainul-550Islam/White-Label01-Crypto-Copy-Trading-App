"""The bridge from persisted datasets to the Part 6 replay engine.

No second replay engine, no second event model: this package converts a
validated dataset version into the exact ``HistoricalDataset`` Part 6 already
consumes, and refuses every state (quarantined, checksum-mismatched, window
disagreement) in which that conversion would be a lie.
"""

from __future__ import annotations

from wlct_trading.datasets.replay.source import (
    DatasetReplayBundle,
    DatasetReplayError,
    load_for_backtest,
    status_is_valid,
    stream_events,
)

__all__ = [
    "DatasetReplayBundle",
    "DatasetReplayError",
    "load_for_backtest",
    "status_is_valid",
    "stream_events",
]
