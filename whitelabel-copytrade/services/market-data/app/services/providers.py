"""Upstream market data providers.

Part 1 defines the provider contract and the public REST poller. Authenticated
and websocket feeds arrive with the trading work; the contract below is what
they will implement, so nothing downstream has to change when they do.

No provider here ever needs a user's exchange credentials: reference prices come
from public endpoints only.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import httpx

from app.schemas import Quote

logger = logging.getLogger(__name__)


class MarketDataProvider(ABC):
    """Contract every upstream source implements."""

    name: str

    @abstractmethod
    async def fetch_quote(self, client: httpx.AsyncClient, symbol: str) -> Quote | None:
        """Returns a quote, or None when the symbol is unavailable upstream."""


def _to_decimal(value: object) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


class BinancePublicProvider(MarketDataProvider):
    """Public ticker endpoint. No credentials, no user data."""

    name = "binance"
    base_url = "https://api.binance.com"

    async def fetch_quote(self, client: httpx.AsyncClient, symbol: str) -> Quote | None:
        venue_symbol = symbol.replace("/", "").replace("-", "").upper()

        try:
            response = await client.get(
                f"{self.base_url}/api/v3/ticker/24hr",
                params={"symbol": venue_symbol},
                timeout=5.0,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as error:
            logger.warning(
                "provider.fetch_failed",
                extra={
                    "event": "provider.fetch_failed",
                    "provider": self.name,
                    "symbol": symbol,
                    "error_type": type(error).__name__,
                },
            )
            return None

        last = _to_decimal(payload.get("lastPrice"))
        if last is None or last <= 0:
            return None

        return Quote(
            symbol=symbol.upper(),
            source=self.name,
            bid=_to_decimal(payload.get("bidPrice")),
            ask=_to_decimal(payload.get("askPrice")),
            last=last,
            volume24h=_to_decimal(payload.get("volume")),
            change24hPct=_to_decimal(payload.get("priceChangePercent")),
            stale=False,
            asOf=datetime.now(timezone.utc),
        )


class BybitPublicProvider(MarketDataProvider):
    """Public ticker endpoint used as the fallback source."""

    name = "bybit"
    base_url = "https://api.bybit.com"

    async def fetch_quote(self, client: httpx.AsyncClient, symbol: str) -> Quote | None:
        venue_symbol = symbol.replace("/", "").replace("-", "").upper()

        try:
            response = await client.get(
                f"{self.base_url}/v5/market/tickers",
                params={"category": "spot", "symbol": venue_symbol},
                timeout=5.0,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as error:
            logger.warning(
                "provider.fetch_failed",
                extra={
                    "event": "provider.fetch_failed",
                    "provider": self.name,
                    "symbol": symbol,
                    "error_type": type(error).__name__,
                },
            )
            return None

        entries = payload.get("result", {}).get("list", [])
        if not entries:
            return None

        entry = entries[0]
        last = _to_decimal(entry.get("lastPrice"))
        if last is None or last <= 0:
            return None

        change = _to_decimal(entry.get("price24hPcnt"))

        return Quote(
            symbol=symbol.upper(),
            source=self.name,
            bid=_to_decimal(entry.get("bid1Price")),
            ask=_to_decimal(entry.get("ask1Price")),
            last=last,
            volume24h=_to_decimal(entry.get("volume24h")),
            # Bybit reports a ratio; the platform standardises on percent.
            change24hPct=change * Decimal("100") if change is not None else None,
            stale=False,
            asOf=datetime.now(timezone.utc),
        )


PROVIDERS: dict[str, MarketDataProvider] = {
    BinancePublicProvider.name: BinancePublicProvider(),
    BybitPublicProvider.name: BybitPublicProvider(),
}


def resolve_providers(names: list[str]) -> list[MarketDataProvider]:
    """Maps configured source names onto provider instances, skipping unknowns."""
    resolved: list[MarketDataProvider] = []

    for name in names:
        provider = PROVIDERS.get(name)
        if provider is None:
            logger.warning(
                "provider.unknown",
                extra={"event": "provider.unknown", "provider": name},
            )
            continue
        resolved.append(provider)

    return resolved
