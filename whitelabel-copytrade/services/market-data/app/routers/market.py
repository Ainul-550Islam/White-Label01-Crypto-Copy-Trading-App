"""Reference price endpoints.

Read-only and internal. Prices are served from the shared cache; the service
never calls an upstream venue on the request path, which keeps latency flat and
stops a burst of API traffic from exhausting an exchange rate limit.
"""

from __future__ import annotations

from typing import Annotated

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.config import Settings, get_settings
from app.schemas import Quote, QuoteListResponse, SymbolListResponse
from app.security import require_internal_auth
from app.services.quote_cache import QuoteCache

router = APIRouter(prefix="/v1/market", tags=["market"], dependencies=[Depends(require_internal_auth)])


def get_cache(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> QuoteCache:
    client: aioredis.Redis | None = getattr(request.app.state, "redis", None)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "SERVICE_UNAVAILABLE", "message": "Quote cache is not available."},
        )
    return QuoteCache(settings, client)


@router.get("/symbols", response_model=SymbolListResponse, response_model_by_alias=True)
async def list_symbols(
    settings: Annotated[Settings, Depends(get_settings)],
) -> SymbolListResponse:
    return SymbolListResponse(
        symbols=settings.symbols,
        sources=settings.sources,
        pollIntervalSeconds=settings.MARKET_DATA_POLL_INTERVAL_SECONDS,
        streamingEnabled=settings.MARKET_DATA_STREAMING_ENABLED,
    )


@router.get("/quotes", response_model=QuoteListResponse, response_model_by_alias=True)
async def list_quotes(
    cache: Annotated[QuoteCache, Depends(get_cache)],
    settings: Annotated[Settings, Depends(get_settings)],
    symbols: Annotated[str | None, Query(max_length=512)] = None,
) -> QuoteListResponse:
    """Returns cached quotes for the requested symbols, or for all tracked ones."""
    requested = (
        [item.strip().upper() for item in symbols.split(",") if item.strip()]
        if symbols
        else settings.symbols
    )

    # Only tracked symbols are served: an arbitrary symbol would be a cache miss
    # at best and an unbounded key lookup at worst.
    tracked = set(settings.symbols)
    allowed = [symbol for symbol in requested if symbol in tracked]

    return QuoteListResponse(quotes=await cache.get_many(allowed))


@router.get("/quotes/{symbol:path}", response_model=Quote, response_model_by_alias=True)
async def get_quote(
    symbol: str,
    cache: Annotated[QuoteCache, Depends(get_cache)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Quote:
    normalised = symbol.upper()

    if normalised not in set(settings.symbols):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": f"Symbol {normalised} is not tracked."},
        )

    quote = await cache.get(normalised)
    if quote is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "SERVICE_UNAVAILABLE",
                "message": f"No price is currently available for {normalised}.",
            },
        )

    return quote
