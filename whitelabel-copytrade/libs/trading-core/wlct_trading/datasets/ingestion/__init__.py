"""Historical data sources and the pipeline that stores what they yield.

Sources normalise; the pipeline persists, validates and finalises. The split
is load-bearing: it is what keeps venue-specific knowledge (CSV eras, zip
layouts, millisecond conventions) inside the ``ingestion`` package and out of
everything that reads datasets back, so the replay path never needs to know
which venue produced the bytes.
"""

from __future__ import annotations

from wlct_trading.datasets.ingestion.base import (
    HistoricalDataSource,
    IngestionRequest,
    SourceFileDescriptor,
    SourceRecord,
    validate_source_label,
)
from wlct_trading.datasets.ingestion.binance import (
    BinanceFetchError,
    BinanceVisionSource,
    dates_in_window,
    parse_agg_trades_csv,
    parse_klines_rows,
    venue_symbol,
)
from wlct_trading.datasets.ingestion.local import LocalJsonlSource
from wlct_trading.datasets.ingestion.pipeline import (
    IngestionOutcome,
    IngestionPipeline,
    PipelineError,
)

__all__ = [
    "BinanceFetchError",
    "BinanceVisionSource",
    "HistoricalDataSource",
    "IngestionOutcome",
    "IngestionPipeline",
    "IngestionRequest",
    "LocalJsonlSource",
    "PipelineError",
    "SourceFileDescriptor",
    "SourceRecord",
    "dates_in_window",
    "parse_agg_trades_csv",
    "parse_klines_rows",
    "validate_source_label",
    "venue_symbol",
]
