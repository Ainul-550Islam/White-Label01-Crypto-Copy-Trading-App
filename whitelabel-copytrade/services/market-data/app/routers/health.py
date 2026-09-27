"""Health endpoints for the market data service."""

from __future__ import annotations

import time
from typing import Annotated

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Request, Response, status

from app import __version__
from app.config import Settings, get_settings
from app.schemas import DependencyHealth, HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])

_STARTED_AT = time.monotonic()


@router.get("/health", response_model=HealthResponse, response_model_by_alias=True)
async def liveness(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        environment=settings.NODE_ENV,
        streamingEnabled=settings.MARKET_DATA_STREAMING_ENABLED,
        trackedSymbols=len(settings.symbols),
        uptimeSeconds=int(time.monotonic() - _STARTED_AT),
    )


@router.get("/health/ready", response_model=ReadinessResponse, response_model_by_alias=True)
async def readiness(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReadinessResponse:
    """Ready when Redis answers. The poller state is reported but not fatal."""
    dependencies: list[DependencyHealth] = []

    client: aioredis.Redis | None = getattr(request.app.state, "redis", None)
    started = time.perf_counter()

    if client is None:
        dependencies.append(
            DependencyHealth(name="redis", healthy=False, detail="not_initialised")
        )
    else:
        try:
            await client.ping()
            dependencies.append(
                DependencyHealth(
                    name="redis",
                    healthy=True,
                    latencyMs=round((time.perf_counter() - started) * 1000, 2),
                )
            )
        except Exception as error:  # noqa: BLE001 - the probe must never raise
            dependencies.append(
                DependencyHealth(name="redis", healthy=False, detail=type(error).__name__)
            )

    poller = getattr(request.app.state, "poller", None)
    dependencies.append(
        DependencyHealth(
            name="quote-poller",
            healthy=bool(poller is not None and poller.last_cycle_ok),
            detail=None if poller is not None else "not_started",
        )
    )

    redis_healthy = dependencies[0].healthy
    if not redis_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadinessResponse(
        status="ok" if redis_healthy else "degraded",
        dependencies=dependencies,
    )
