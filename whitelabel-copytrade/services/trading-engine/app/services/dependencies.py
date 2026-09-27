"""Dependency probes shared by the readiness endpoint."""

from __future__ import annotations

import logging
import time

import asyncpg
import redis.asyncio as aioredis

from app.config import Settings
from app.schemas import DependencyHealth

logger = logging.getLogger(__name__)


async def check_postgres(settings: Settings, timeout: float = 2.0) -> DependencyHealth:
    """Opens a short-lived connection and runs a trivial query."""
    started = time.perf_counter()
    connection: asyncpg.Connection | None = None

    try:
        # asyncpg_dsn, not DATABASE_URL: Prisma-only query parameters such as
        # `?schema=public` would otherwise be sent to the server as runtime
        # settings and every connection would fail.
        connection = await asyncpg.connect(settings.asyncpg_dsn, timeout=timeout)
        await connection.fetchval("SELECT 1")
        return DependencyHealth(
            name="postgres",
            healthy=True,
            latencyMs=round((time.perf_counter() - started) * 1000, 2),
        )
    except Exception as error:  # noqa: BLE001 - the probe must never raise
        logger.warning(
            "dependency.postgres_unavailable",
            extra={"event": "dependency.postgres_unavailable", "error_type": type(error).__name__},
        )
        # The exception message can contain the DSN, so only the class is exposed.
        return DependencyHealth(
            name="postgres",
            healthy=False,
            latencyMs=round((time.perf_counter() - started) * 1000, 2),
            detail=type(error).__name__,
        )
    finally:
        if connection is not None:
            await connection.close()


async def check_redis(settings: Settings, timeout: float = 2.0) -> DependencyHealth:
    """Pings Redis on a dedicated short-lived client."""
    started = time.perf_counter()
    client = aioredis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD or None,
        db=settings.REDIS_DB,
        ssl=settings.REDIS_TLS,
        socket_connect_timeout=timeout,
        socket_timeout=timeout,
    )

    try:
        await client.ping()
        return DependencyHealth(
            name="redis",
            healthy=True,
            latencyMs=round((time.perf_counter() - started) * 1000, 2),
        )
    except Exception as error:  # noqa: BLE001 - the probe must never raise
        logger.warning(
            "dependency.redis_unavailable",
            extra={"event": "dependency.redis_unavailable", "error_type": type(error).__name__},
        )
        return DependencyHealth(
            name="redis",
            healthy=False,
            latencyMs=round((time.perf_counter() - started) * 1000, 2),
            detail=type(error).__name__,
        )
    finally:
        await client.aclose()
