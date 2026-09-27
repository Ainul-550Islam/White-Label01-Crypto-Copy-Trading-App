"""Process-level runner for the live market-data service.

Composition only. Everything this module does is build the concrete transports,
hand them to the adapter, hand the adapter to the feed, install signal handlers
and print health on a timer. There is no exchange-specific logic here — no
stream names, no parsing, no sequence rules — because all of that belongs to the
adapter and would be wrong to duplicate at the process level.

Scope, stated plainly: **public market data only**. No credentials are read, no
request is signed, and no order is submitted. Live order execution is not
implemented in this path.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import signal
from typing import Any

from wlct_trading.exchanges.binance import BinanceMarketDataAdapter
from wlct_trading.metrics import ConnectivityMetrics
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.feed import FeedCallbacks, FeedHealth, MarketDataFeed
from wlct_trading.net.http_client import HttpxGetter
from wlct_trading.net.websocket_client import WebsocketsTransportFactory

__all__ = ["MarketDataRunner", "configure_logging", "run"]

_LOGGER = logging.getLogger("wlct_trading.net.runner")


class _JsonFormatter(logging.Formatter):
    """Structured log lines, matching what the other services emit.

    Structured rather than free text because these logs are shipped and queried.
    No message field here is ever populated with a credential: the market-data
    path holds none.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"))


def configure_logging(level: str = "INFO", *, structured: bool = True) -> None:
    """Install a root handler once, without clobbering an existing one."""
    root = logging.getLogger()
    if root.handlers:
        root.setLevel(level.upper())
        return
    handler = logging.StreamHandler()
    handler.setFormatter(
        _JsonFormatter()
        if structured
        else logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level.upper())


class MarketDataRunner:
    """Owns the process lifetime of one market-data feed."""

    __slots__ = (
        "_settings",
        "_metrics",
        "_http",
        "_factory",
        "_adapter",
        "_feed",
        "_stop_event",
        "_health_task",
        "_callbacks",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        metrics: ConnectivityMetrics | None = None,
        callbacks: FeedCallbacks | None = None,
    ) -> None:
        self._settings = settings
        self._metrics = metrics or ConnectivityMetrics()
        self._callbacks = callbacks
        self._http = HttpxGetter(settings)
        self._factory = WebsocketsTransportFactory(settings)
        self._adapter = BinanceMarketDataAdapter(
            # Public market data only. This adapter has no parameter that could
            # carry an API key, by construction.
            self._http,
            testnet=settings.use_testnet,
            # One source of truth for the endpoints: the adapter builds every
            # REST path and every stream URL from these, so nothing downstream
            # concatenates a host of its own.
            rest_base=settings.binance_rest_url,
            ws_base=settings.binance_ws_url,
        )
        self._feed = MarketDataFeed(
            self._adapter,
            settings,
            self._factory,
            metrics=self._metrics,
            callbacks=callbacks,
        )
        self._stop_event = asyncio.Event()
        self._health_task: asyncio.Task[None] | None = None

    @property
    def feed(self) -> MarketDataFeed:
        return self._feed

    @property
    def metrics(self) -> ConnectivityMetrics:
        return self._metrics

    def health(self) -> FeedHealth:
        return self._feed.health()

    def request_stop(self) -> None:
        """Ask the runner to wind down. Safe to call from a signal handler."""
        self._stop_event.set()

    async def start(self) -> None:
        _LOGGER.info(
            "Starting live market data: %s",
            json.dumps(self._settings.to_public_dict(), separators=(",", ":")),
        )
        await self._feed.start()
        self._health_task = asyncio.create_task(
            self._report_health(), name="wlct-market-data-health"
        )

    async def stop(self) -> None:
        """Stop the feed and release the HTTP session.

        Ordered so nothing is left holding a socket: cancel the reporter, stop
        the feed (which unsubscribes and closes the websocket), then close the
        HTTP pool.
        """
        if self._health_task is not None:
            self._health_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._health_task
            self._health_task = None

        await self._feed.stop()
        await self._http.aclose()
        _LOGGER.info(
            "Market data stopped. Final counters: %s",
            json.dumps(self._metrics.transport_totals(), separators=(",", ":")),
        )

    async def run(self, *, duration_seconds: float | None = None) -> FeedHealth:
        """Run until stopped, or for a bounded duration.

        ``duration_seconds`` is what the smoke test uses; leaving it ``None`` is
        the service mode, which runs until a signal arrives.
        """
        await self.start()
        try:
            if duration_seconds is None:
                await self._stop_event.wait()
            else:
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(
                        self._stop_event.wait(), timeout=duration_seconds
                    )
            return self._feed.health()
        finally:
            await self.stop()

    async def _report_health(self) -> None:
        """Log a health line on a fixed cadence."""
        interval = float(self._settings.health_report_interval_seconds)
        while True:
            await asyncio.sleep(interval)
            health = self._feed.health()
            _LOGGER.info(
                "Health: %s",
                json.dumps(
                    {
                        "status": health.status,
                        "state": health.state.value,
                        "connected": health.connected,
                        "fresh": health.fresh,
                        "tradeable": list(health.tradeable_symbols),
                        "untradeable": list(health.untradeable_symbols),
                        "staleStreams": list(health.stale_streams),
                        "reconnects": health.reconnect_count,
                        "messages": health.messages_received,
                        "parseErrors": health.parse_errors,
                    },
                    separators=(",", ":"),
                ),
            )

    def install_signal_handlers(self, loop: asyncio.AbstractEventLoop) -> None:
        """Turn SIGINT/SIGTERM into an orderly stop.

        Without this a container stop would kill the process mid-frame, leaving
        the venue holding a half-open connection until its own timeout.
        """
        for signal_name in ("SIGINT", "SIGTERM"):
            handled = getattr(signal, signal_name, None)
            if handled is None:  # pragma: no cover - platform dependent
                continue
            try:
                loop.add_signal_handler(handled, self.request_stop)
            except (NotImplementedError, RuntimeError):  # pragma: no cover
                # Windows, or a non-main thread. The runner is still stoppable
                # through request_stop().
                pass


async def run(
    settings: TransportSettings | None = None,
    *,
    duration_seconds: float | None = None,
) -> FeedHealth:
    """Build a runner from the environment and run it."""
    resolved = settings or TransportSettings.from_env()
    runner = MarketDataRunner(resolved)
    runner.install_signal_handlers(asyncio.get_running_loop())
    return await runner.run(duration_seconds=duration_seconds)
