"""Background price poller.

Runs inside the service process as a single asyncio task. Each cycle asks the
configured providers in order and keeps the first usable answer, so one venue
going down degrades quality rather than availability. Failures are logged and
the loop continues: a poller that dies on the first HTTP error is worse than no
poller at all.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable

import httpx

from app.config import Settings
from app.services.providers import MarketDataProvider, resolve_providers
from app.services.quote_cache import QuoteCache

logger = logging.getLogger(__name__)


class QuotePoller:
    """Periodically refreshes the cached quote for every tracked symbol."""

    def __init__(
        self,
        settings: Settings,
        cache: QuoteCache,
        *,
        observer: Callable[[int, bool], None] | None = None,
    ) -> None:
        self._settings = settings
        self._cache = cache
        self._providers: list[MarketDataProvider] = resolve_providers(settings.sources)
        self._task: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()
        self._last_cycle_ok = False
        # Part 9: an optional per-cycle observer (the observability hub).
        # Optional by contract: the poller must run identically when nobody
        # is watching, and an observer failure must never break a cycle.
        self._observer = observer

    def _notify(self, updated: int, ok: bool) -> None:
        if self._observer is None:
            return
        try:
            self._observer(updated, ok)
        except Exception as error:  # observability never outranks the data path
            logger.warning(
                "poller.observer_failed",
                extra={"event": "poller.observer_failed", "error_type": type(error).__name__},
            )

    @property
    def last_cycle_ok(self) -> bool:
        return self._last_cycle_ok

    def start(self) -> None:
        if self._task is not None:
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._run(), name="quote-poller")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task is None:
            return

        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        async with httpx.AsyncClient(
            headers={"user-agent": "wlct-market-data/1.0"},
            timeout=httpx.Timeout(10.0),
        ) as client:
            while not self._stopping.is_set():
                try:
                    await self._cycle(client)
                except Exception as error:  # noqa: BLE001 - the loop must survive
                    self._last_cycle_ok = False
                    self._notify(0, False)
                    logger.error(
                        "poller.cycle_failed",
                        extra={
                            "event": "poller.cycle_failed",
                            "error_type": type(error).__name__,
                        },
                    )

                try:
                    await asyncio.wait_for(
                        self._stopping.wait(),
                        timeout=self._settings.MARKET_DATA_POLL_INTERVAL_SECONDS,
                    )
                except TimeoutError:
                    continue

    async def _cycle(self, client: httpx.AsyncClient) -> int:
        updated = 0

        for symbol in self._settings.symbols:
            for provider in self._providers:
                quote = await provider.fetch_quote(client, symbol)
                if quote is None:
                    continue
                await self._cache.put(quote)
                updated += 1
                break

        self._last_cycle_ok = updated > 0
        self._notify(updated, self._last_cycle_ok)

        logger.info(
            "poller.cycle_complete",
            extra={
                "event": "poller.cycle_complete",
                "symbols": len(self._settings.symbols),
                "updated": updated,
            },
        )
        return updated
