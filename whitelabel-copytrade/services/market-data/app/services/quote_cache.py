"""Redis-backed quote cache.

Quotes are shared across every API node and every worker, so they live in Redis
rather than process memory. Entries carry their own `asOf` timestamp and the
reader - not the writer - decides whether a value is too old to trust, which
keeps freshness policy in one place.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal

import redis.asyncio as aioredis

from app.config import Settings
from app.schemas import Quote

logger = logging.getLogger(__name__)


def quote_key(symbol: str) -> str:
    return f"market:quote:{symbol.upper()}"


class QuoteCache:
    """Reads and writes quotes with an explicit staleness contract."""

    def __init__(self, settings: Settings, client: aioredis.Redis) -> None:
        self._settings = settings
        self._client = client

    async def put(self, quote: Quote) -> None:
        payload = {
            "symbol": quote.symbol,
            "source": quote.source,
            "bid": str(quote.bid) if quote.bid is not None else None,
            "ask": str(quote.ask) if quote.ask is not None else None,
            "last": str(quote.last),
            "volume24h": str(quote.volume_24h) if quote.volume_24h is not None else None,
            "change24hPct": (
                str(quote.change_24h_pct) if quote.change_24h_pct is not None else None
            ),
            "asOf": quote.as_of.isoformat(),
        }

        # The TTL is generous relative to the poll interval so a brief upstream
        # outage degrades to "stale" rather than "missing".
        await self._client.set(
            quote_key(quote.symbol),
            json.dumps(payload),
            ex=self._settings.MARKET_DATA_CACHE_TTL_SECONDS * 4,
        )

    async def get(self, symbol: str) -> Quote | None:
        raw = await self._client.get(quote_key(symbol))
        if raw is None:
            return None

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(
                "quote.corrupt_cache_entry",
                extra={"event": "quote.corrupt_cache_entry", "symbol": symbol},
            )
            return None

        as_of = datetime.fromisoformat(payload["asOf"])
        age_seconds = (datetime.now(timezone.utc) - as_of).total_seconds()

        return Quote(
            symbol=payload["symbol"],
            source=payload["source"],
            bid=Decimal(payload["bid"]) if payload["bid"] is not None else None,
            ask=Decimal(payload["ask"]) if payload["ask"] is not None else None,
            last=Decimal(payload["last"]),
            volume24h=Decimal(payload["volume24h"]) if payload["volume24h"] is not None else None,
            change24hPct=(
                Decimal(payload["change24hPct"]) if payload["change24hPct"] is not None else None
            ),
            stale=age_seconds > self._settings.MARKET_DATA_CACHE_TTL_SECONDS,
            asOf=as_of,
        )

    async def get_many(self, symbols: list[str]) -> list[Quote]:
        quotes: list[Quote] = []
        for symbol in symbols:
            quote = await self.get(symbol)
            if quote is not None:
                quotes.append(quote)
        return quotes
