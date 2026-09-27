"""Health endpoints.

Unauthenticated on purpose: orchestrators probe them before any credential is
mounted. They expose no tenant data, no configuration values and no secrets.
"""

from __future__ import annotations

import asyncio
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app import __version__
from app.config import Settings, get_settings
from app.schemas import HealthResponse, ReadinessResponse
from app.services.dependencies import check_postgres, check_redis

router = APIRouter(tags=["health"])

_STARTED_AT = time.monotonic()


@router.get("/health", response_model=HealthResponse, response_model_by_alias=True)
async def liveness(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    """Liveness: the process is up. Touches no dependency."""
    return HealthResponse(
        status="ok",
        version=__version__,
        environment=settings.NODE_ENV,
        executionEnabled=settings.EXECUTION_ENABLED,
        sandboxMode=settings.EXCHANGE_SANDBOX_MODE,
        uptimeSeconds=int(time.monotonic() - _STARTED_AT),
    )


@router.get("/health/ready", response_model=ReadinessResponse, response_model_by_alias=True)
async def readiness(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReadinessResponse:
    """Readiness: PostgreSQL and Redis must both answer."""
    postgres, redis_health = await asyncio.gather(
        check_postgres(settings),
        check_redis(settings),
    )

    dependencies = [postgres, redis_health]
    healthy = all(dependency.healthy for dependency in dependencies)

    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadinessResponse(
        status="ok" if healthy else "degraded",
        dependencies=dependencies,
    )
