"""Configuration for the production transport layer.

Part 3's core is configuration-free on purpose: it takes injected callables and
never reads the environment. That property is preserved — this module lives in
:mod:`wlct_trading.net`, the optional "live transport" subpackage, and is the
*only* place in the library that reads ``os.environ``.

Parsing is stdlib-only. Pydantic is a fine dependency for a service, but the
trading-core library is deliberately installable with nothing but the standard
library plus the two network clients, and a settings framework is not worth
giving that up.

Every timeout has a finite default. There is no code path here that produces an
infinite network timeout.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_SPOT_REST_BASE,
    BINANCE_SPOT_WS_BASE,
    BINANCE_TESTNET_REST_BASE,
    BINANCE_TESTNET_WS_BASE,
)
from wlct_trading.transport.subscriptions import MarketDataChannel

__all__ = [
    "TransportSettings",
    "InvalidTransportSettings",
    "parse_bool",
    "parse_int",
    "parse_symbol_list",
]


class InvalidTransportSettings(ValueError):
    """Raised when configuration is missing, malformed or unsafe.

    Raised at startup rather than tolerated. A service that boots with a
    nonsensical timeout and discovers it during a venue incident is worse than
    one that refuses to boot.
    """


def parse_bool(raw: str | None, default: bool, *, name: str) -> bool:
    """Parse a boolean environment value strictly.

    Anything unrecognised raises. Silently treating ``"flase"`` as ``False``
    would disable a channel an operator believed they had enabled.
    """
    if raw is None or raw.strip() == "":
        return default
    lowered = raw.strip().lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise InvalidTransportSettings(
        f"{name} must be a boolean (true/false), got {raw!r}."
    )


def parse_int(
    raw: str | None,
    default: int,
    *,
    name: str,
    minimum: int = 1,
    maximum: int | None = None,
) -> int:
    """Parse a bounded integer environment value."""
    if raw is None or raw.strip() == "":
        value = default
    else:
        try:
            value = int(raw.strip())
        except ValueError as exc:
            raise InvalidTransportSettings(
                f"{name} must be an integer, got {raw!r}."
            ) from exc
    if value < minimum:
        raise InvalidTransportSettings(
            f"{name} must be at least {minimum}, got {value}."
        )
    if maximum is not None and value > maximum:
        raise InvalidTransportSettings(
            f"{name} must be at most {maximum}, got {value}."
        )
    return value


def parse_symbol_list(raw: str | None, default: str) -> tuple[str, ...]:
    """Split a comma-separated symbol list.

    Only splitting happens here. Normalisation to the canonical ``BASE-QUOTE``
    form is the job of :mod:`wlct_trading.exchanges.symbols`, which already owns
    that vocabulary; duplicating it here is exactly how two spellings of the
    same market end up in circulation.
    """
    source = raw if raw is not None and raw.strip() else default
    items = [item.strip() for item in source.split(",")]
    return tuple(item for item in items if item)


@dataclass(slots=True, frozen=True)
class TransportSettings:
    """Runtime settings for the live market-data transport.

    Contains no credentials, and cannot: public market data requires none, and
    exchange API keys live encrypted per trading account in PostgreSQL. There is
    deliberately no field here that could hold a secret.
    """

    # --- Endpoints -----------------------------------------------------
    binance_ws_url: str = BINANCE_SPOT_WS_BASE
    binance_rest_url: str = BINANCE_SPOT_REST_BASE
    use_testnet: bool = False

    # --- What to subscribe to -----------------------------------------
    symbols: tuple[str, ...] = ("BTC/USDT", "ETH/USDT")
    ticker_enabled: bool = True
    trades_enabled: bool = True
    orderbook_enabled: bool = True

    # --- Websocket timeouts (milliseconds) -----------------------------
    ws_connect_timeout_ms: int = 10_000
    #: Backstop only. The connection manager's heartbeat is the primary
    #: liveness detector; this catches a socket wedged below that layer. It is
    #: deliberately generous because a thin symbol's trade stream can be
    #: legitimately silent for minutes, and Binance's own server pings are
    #: answered by the client library without surfacing as messages.
    ws_receive_timeout_ms: int = 300_000
    ws_heartbeat_timeout_ms: int = 90_000
    ws_heartbeat_interval_ms: int = 20_000
    #: Client-initiated ping cadence handed to the websocket library. Binance
    #: pings every 3 minutes and expects a pong within 10; the library answers
    #: those automatically. This is the reverse direction, used to notice a peer
    #: that has gone away silently.
    ws_ping_interval_ms: int = 180_000
    ws_ping_timeout_ms: int = 60_000
    ws_close_timeout_ms: int = 5_000
    #: Frame size ceiling. Binance depth frames are small; an unbounded reader
    #: is a memory-exhaustion vector.
    ws_max_frame_bytes: int = 8 * 1024 * 1024

    # --- HTTP timeouts (milliseconds) ----------------------------------
    http_connect_timeout_ms: int = 5_000
    http_read_timeout_ms: int = 10_000
    http_total_timeout_ms: int = 15_000
    http_max_retries: int = 3
    http_max_connections: int = 20

    # --- Order book -----------------------------------------------------
    orderbook_snapshot_depth: int = 1_000
    orderbook_max_buffered_deltas: int = 5_000
    orderbook_max_resync_attempts: int = 10
    orderbook_staleness_threshold_ms: int = 5_000

    # --- Reconnect -------------------------------------------------------
    reconnect_base_delay_ms: int = 500
    reconnect_max_delay_ms: int = 30_000
    reconnect_max_attempts: int = 20

    # --- Runner ----------------------------------------------------------
    health_report_interval_seconds: int = 15
    smoke_test_duration_seconds: int = 30

    def __post_init__(self) -> None:
        if not self.binance_ws_url.startswith("wss://"):
            raise InvalidTransportSettings(
                f"BINANCE_WS_URL must use wss:// (TLS). Got {self.binance_ws_url!r}. "
                f"Plaintext websocket traffic to an exchange is never acceptable."
            )
        if not self.binance_rest_url.startswith("https://"):
            raise InvalidTransportSettings(
                f"BINANCE_REST_URL must use https://. Got {self.binance_rest_url!r}."
            )
        if self.ws_heartbeat_timeout_ms <= self.ws_heartbeat_interval_ms:
            raise InvalidTransportSettings(
                "WEBSOCKET_HEARTBEAT_TIMEOUT_MS must exceed "
                "WEBSOCKET_HEARTBEAT_INTERVAL_MS, otherwise a healthy connection "
                "is torn down before it can prove itself alive."
            )
        if self.http_total_timeout_ms < self.http_read_timeout_ms:
            raise InvalidTransportSettings(
                "HTTP_TOTAL_TIMEOUT_MS must be at least HTTP_READ_TIMEOUT_MS."
            )
        if not self.symbols:
            raise InvalidTransportSettings(
                "MARKET_DATA_SYMBOLS is empty; there would be nothing to stream."
            )
        if not self.enabled_channels:
            raise InvalidTransportSettings(
                "Every market-data channel is disabled. Enable at least one of "
                "MARKET_DATA_TICKER_ENABLED, MARKET_DATA_TRADES_ENABLED or "
                "MARKET_DATA_ORDERBOOK_ENABLED."
            )

    @property
    def enabled_channels(self) -> tuple[MarketDataChannel, ...]:
        """Channels to subscribe to, in a stable order.

        ``BOOK_TICKER`` is what "ticker" maps to: it is the best bid/ask stream,
        updated on every book change, and it is what the risk engine's
        price-deviation checks need. The 1-second rolling ``TICKER`` stream is a
        statistics feed, not a quote feed.
        """
        channels: list[MarketDataChannel] = []
        if self.orderbook_enabled:
            channels.append(MarketDataChannel.ORDER_BOOK)
        if self.trades_enabled:
            channels.append(MarketDataChannel.TRADES)
        if self.ticker_enabled:
            channels.append(MarketDataChannel.BOOK_TICKER)
        return tuple(channels)

    @classmethod
    def from_env(
        cls, environ: Mapping[str, str] | None = None
    ) -> "TransportSettings":
        """Build settings from the environment.

        Passing ``environ`` explicitly keeps this testable without mutating the
        real process environment.
        """
        env = os.environ if environ is None else environ

        use_testnet = parse_bool(
            env.get("EXCHANGE_USE_TESTNET"), False, name="EXCHANGE_USE_TESTNET"
        )
        default_ws = BINANCE_TESTNET_WS_BASE if use_testnet else BINANCE_SPOT_WS_BASE
        default_rest = (
            BINANCE_TESTNET_REST_BASE if use_testnet else BINANCE_SPOT_REST_BASE
        )

        return cls(
            binance_ws_url=(env.get("BINANCE_WS_URL") or default_ws).strip(),
            binance_rest_url=(env.get("BINANCE_REST_URL") or default_rest).strip(),
            use_testnet=use_testnet,
            symbols=parse_symbol_list(
                env.get("MARKET_DATA_SYMBOLS"), "BTC/USDT,ETH/USDT"
            ),
            ticker_enabled=parse_bool(
                env.get("MARKET_DATA_TICKER_ENABLED"),
                True,
                name="MARKET_DATA_TICKER_ENABLED",
            ),
            trades_enabled=parse_bool(
                env.get("MARKET_DATA_TRADES_ENABLED"),
                True,
                name="MARKET_DATA_TRADES_ENABLED",
            ),
            orderbook_enabled=parse_bool(
                env.get("MARKET_DATA_ORDERBOOK_ENABLED"),
                True,
                name="MARKET_DATA_ORDERBOOK_ENABLED",
            ),
            ws_connect_timeout_ms=parse_int(
                env.get("WEBSOCKET_CONNECT_TIMEOUT_MS"),
                10_000,
                name="WEBSOCKET_CONNECT_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            ws_receive_timeout_ms=parse_int(
                env.get("WEBSOCKET_RECEIVE_TIMEOUT_MS"),
                300_000,
                name="WEBSOCKET_RECEIVE_TIMEOUT_MS",
                minimum=1_000,
                maximum=3_600_000,
            ),
            ws_heartbeat_timeout_ms=parse_int(
                env.get("WEBSOCKET_HEARTBEAT_TIMEOUT_MS"),
                90_000,
                name="WEBSOCKET_HEARTBEAT_TIMEOUT_MS",
                minimum=2_000,
                maximum=600_000,
            ),
            ws_heartbeat_interval_ms=parse_int(
                env.get("WS_HEARTBEAT_INTERVAL_MS"),
                20_000,
                name="WS_HEARTBEAT_INTERVAL_MS",
                minimum=1_000,
                maximum=300_000,
            ),
            ws_ping_interval_ms=parse_int(
                env.get("WEBSOCKET_PING_INTERVAL_MS"),
                180_000,
                name="WEBSOCKET_PING_INTERVAL_MS",
                minimum=5_000,
                maximum=600_000,
            ),
            ws_ping_timeout_ms=parse_int(
                env.get("WEBSOCKET_PING_TIMEOUT_MS"),
                60_000,
                name="WEBSOCKET_PING_TIMEOUT_MS",
                minimum=1_000,
                maximum=600_000,
            ),
            ws_close_timeout_ms=parse_int(
                env.get("WEBSOCKET_CLOSE_TIMEOUT_MS"),
                5_000,
                name="WEBSOCKET_CLOSE_TIMEOUT_MS",
                minimum=100,
                maximum=60_000,
            ),
            ws_max_frame_bytes=parse_int(
                env.get("WEBSOCKET_MAX_FRAME_BYTES"),
                8 * 1024 * 1024,
                name="WEBSOCKET_MAX_FRAME_BYTES",
                minimum=64 * 1024,
                maximum=64 * 1024 * 1024,
            ),
            http_connect_timeout_ms=parse_int(
                env.get("HTTP_CONNECT_TIMEOUT_MS"),
                5_000,
                name="HTTP_CONNECT_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            http_read_timeout_ms=parse_int(
                env.get("HTTP_READ_TIMEOUT_MS"),
                10_000,
                name="HTTP_READ_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            http_total_timeout_ms=parse_int(
                env.get("HTTP_TOTAL_TIMEOUT_MS"),
                15_000,
                name="HTTP_TOTAL_TIMEOUT_MS",
                minimum=100,
                maximum=300_000,
            ),
            http_max_retries=parse_int(
                env.get("HTTP_MAX_RETRIES"),
                3,
                name="HTTP_MAX_RETRIES",
                minimum=0,
                maximum=10,
            ),
            http_max_connections=parse_int(
                env.get("HTTP_MAX_CONNECTIONS"),
                20,
                name="HTTP_MAX_CONNECTIONS",
                minimum=1,
                maximum=200,
            ),
            orderbook_snapshot_depth=parse_int(
                env.get("ORDERBOOK_SNAPSHOT_DEPTH"),
                1_000,
                name="ORDERBOOK_SNAPSHOT_DEPTH",
                minimum=5,
                maximum=5_000,
            ),
            orderbook_max_buffered_deltas=parse_int(
                env.get("ORDERBOOK_MAX_BUFFERED_DELTAS"),
                5_000,
                name="ORDERBOOK_MAX_BUFFERED_DELTAS",
                minimum=100,
                maximum=100_000,
            ),
            orderbook_max_resync_attempts=parse_int(
                env.get("ORDERBOOK_MAX_RESYNC_ATTEMPTS"),
                10,
                name="ORDERBOOK_MAX_RESYNC_ATTEMPTS",
                minimum=1,
                maximum=100,
            ),
            orderbook_staleness_threshold_ms=parse_int(
                env.get("ORDERBOOK_STALENESS_THRESHOLD_MS"),
                5_000,
                name="ORDERBOOK_STALENESS_THRESHOLD_MS",
                minimum=100,
                maximum=600_000,
            ),
            reconnect_base_delay_ms=parse_int(
                env.get("WS_RECONNECT_BASE_DELAY_MS"),
                500,
                name="WS_RECONNECT_BASE_DELAY_MS",
                minimum=10,
                maximum=60_000,
            ),
            reconnect_max_delay_ms=parse_int(
                env.get("WS_RECONNECT_MAX_DELAY_MS"),
                30_000,
                name="WS_RECONNECT_MAX_DELAY_MS",
                minimum=100,
                maximum=600_000,
            ),
            reconnect_max_attempts=parse_int(
                env.get("WS_RECONNECT_MAX_ATTEMPTS"),
                20,
                name="WS_RECONNECT_MAX_ATTEMPTS",
                minimum=1,
                maximum=1_000,
            ),
            health_report_interval_seconds=parse_int(
                env.get("CONNECTIVITY_METRICS_INTERVAL_SECONDS"),
                15,
                name="CONNECTIVITY_METRICS_INTERVAL_SECONDS",
                minimum=1,
                maximum=3_600,
            ),
            smoke_test_duration_seconds=parse_int(
                env.get("LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS"),
                30,
                name="LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS",
                minimum=1,
                maximum=3_600,
            ),
        )

    def to_public_dict(self) -> dict[str, object]:
        """Log-safe rendering. There are no secrets to omit."""
        return {
            "binanceWsUrl": self.binance_ws_url,
            "binanceRestUrl": self.binance_rest_url,
            "useTestnet": self.use_testnet,
            "symbols": list(self.symbols),
            "channels": [channel.value for channel in self.enabled_channels],
            "wsConnectTimeoutMs": self.ws_connect_timeout_ms,
            "wsReceiveTimeoutMs": self.ws_receive_timeout_ms,
            "wsHeartbeatTimeoutMs": self.ws_heartbeat_timeout_ms,
            "httpConnectTimeoutMs": self.http_connect_timeout_ms,
            "httpReadTimeoutMs": self.http_read_timeout_ms,
            "httpTotalTimeoutMs": self.http_total_timeout_ms,
            "httpMaxRetries": self.http_max_retries,
            "orderbookSnapshotDepth": self.orderbook_snapshot_depth,
            "reconnectMaxAttempts": self.reconnect_max_attempts,
        }
