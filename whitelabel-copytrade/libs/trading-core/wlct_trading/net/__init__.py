"""Optional live network transport for :mod:`wlct_trading`.

Importing this subpackage is what pulls in ``websockets`` and ``httpx``. The
core library imports nothing from here, which is what keeps
``import wlct_trading`` dependency-free and keeps the test suite runnable with
no network stack installed.

Install the extra to use it::

    pip install 'wlct-trading-core[live]'

Scope: **public market data only**. Nothing in this package accepts, reads or
transmits an API credential, and no code path submits an order.
"""

from __future__ import annotations

from wlct_trading.net.config import (
    InvalidTransportSettings,
    TransportSettings,
    parse_bool,
    parse_int,
    parse_symbol_list,
)
from wlct_trading.net.feed import FeedCallbacks, FeedHealth, MarketDataFeed
from wlct_trading.net.http_client import HttpxGetter, InsecureHttpUrl
from wlct_trading.net.normalise import (
    RETRYABLE_HTTP_STATUSES,
    category_for_http_status,
    normalise_http_status,
    normalise_network_exception,
)
from wlct_trading.net.runner import MarketDataRunner, configure_logging, run
from wlct_trading.net.symbols import (
    canonicalise_configured_symbol,
    resolve_configured_symbols,
)
from wlct_trading.net.websocket_client import (
    InsecureWebSocketUrl,
    WebsocketsTransport,
    WebsocketsTransportFactory,
)

__all__ = [
    "FeedCallbacks",
    "FeedHealth",
    "HttpxGetter",
    "InsecureHttpUrl",
    "InsecureWebSocketUrl",
    "InvalidTransportSettings",
    "MarketDataFeed",
    "MarketDataRunner",
    "RETRYABLE_HTTP_STATUSES",
    "TransportSettings",
    "WebsocketsTransport",
    "WebsocketsTransportFactory",
    "canonicalise_configured_symbol",
    "category_for_http_status",
    "configure_logging",
    "normalise_http_status",
    "normalise_network_exception",
    "parse_bool",
    "parse_int",
    "parse_symbol_list",
    "resolve_configured_symbols",
    "run",
]
