"""Dataset readers.

One reader today: the streaming, heap-merged, window-pruned
:class:`~wlct_trading.datasets.readers.streaming.StreamingDatasetReader`. A
second format (Parquet, say) would add a second module here with the same
public shape - ``events()`` over a manifest - so the bridge in
``datasets.replay`` stays a single line of choice rather than a fork.
"""

from __future__ import annotations

from wlct_trading.datasets.readers.streaming import (
    ReaderStats,
    StreamingDatasetReader,
    merge_sort_key,
)

__all__ = ["ReaderStats", "StreamingDatasetReader", "merge_sort_key"]
