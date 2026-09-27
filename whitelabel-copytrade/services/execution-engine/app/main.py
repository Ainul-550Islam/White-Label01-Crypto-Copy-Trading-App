"""Execution engine application factory.

The process owns the money path's runtime and nothing else: no public
routes, no admin surface, no UI. Startup is where wiring mistakes die -
``build_runtime`` refuses live mode, ``get_settings`` refuses missing or
placeholder secrets - so the first request ever served meets either a fully
composed engine or no process at all.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.composition import build_runtime
from app.config import get_settings
from app.incidents_sql import PostgresIncidentRecorder
from app.logging_config import configure_logging
from app.observability import ExecutionEngineObservability
from app.pg_store import open_durable_store
from app.routers import (
    enablement,
    health,
    internal,
    placement,
    retention,
)
from app.routers import (
    incidents as incidents_router,
)
from app.routers import (
    observability as observability_router,
)
from app.security import REQUEST_ID_HEADER

logger = logging.getLogger(__name__)

#: Response header echoing the correlation id, matching the platform's
#: convention so a worker log line and an engine log line join on it.
CORRELATION_HEADER = "x-correlation-id"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Raises through startup on any refused combination - live mode,
        # catalog incoherence - which is the whole safety design: a process
        # that cannot state its wiring does not serve traffic.
        store = None
        pool = None
        incidents = None
        if settings.EXECUTION_STORE_BACKEND == "postgres":
            pool, store = await open_durable_store(settings)
            # Part 17: the sink is built over the SAME pool the store came from,
            # here rather than inside open_durable_store, because this function is
            # where "we have a durable plane" is decided - and passing it down is
            # what lets composition refuse a durable store that arrived without
            # one, instead of quietly defaulting to memory.
            incidents = PostgresIncidentRecorder(pool)
        app.state.runtime = build_runtime(settings, store=store, incidents=incidents)
        # Part 18: the hub is built AFTER the runtime because it reads the
        # runtime's own instruments, and it is NOT wrapped in a try. A hub that
        # cannot register its families - an illegal metric or label name reaching
        # the cardinality law - is a wiring mistake, and this file's opening
        # sentence is that wiring mistakes die at startup rather than being
        # swallowed into a degraded-but-running process. Refusing the boot is also
        # the kinder answer for the operator: a missing scrape is obvious in the
        # startup log, and invisible in every panel that reads zero.
        if settings.OBSERVABILITY_ENABLED:
            app.state.observability = ExecutionEngineObservability(app.state.runtime)
        app.state.store_pool = pool
        logger.info(
            "execution_engine.started",
            extra={
                "event": "execution_engine.started",
                "instance_id": settings.EXECUTION_INSTANCE_ID,
                "version": __version__,
                "wiring": (app.state.runtime.describe() if hasattr(app.state, "runtime") else {}),
            },
        )
        yield
        if pool is not None:
            await pool.close()
        logger.info("execution_engine.stopped", extra={"event": "execution_engine.stopped"})

    app = FastAPI(
        title="wlct execution engine",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    @app.middleware("http")
    async def correlation(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Best-effort id continuity: honour a well-formed incoming id (the
        # worker sends its job's x-request-id), mint one otherwise. Capped
        # at 128 chars so a hostile header cannot bloat every log line.
        incoming = request.headers.get(REQUEST_ID_HEADER)
        correlation_id = (
            incoming
            if incoming is not None and 0 < len(incoming) <= 128 and _printable(incoming)
            else f"eng-{uuid.uuid4().hex[:20]}"
        )
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers[CORRELATION_HEADER] = correlation_id
        return response

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field locations only, never values: a rejected payload may contain
        # exactly the thing it should not, and 422 bodies get screenshotted.
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_FAILED",
                "message": "The command payload does not satisfy the contract.",
                "fields": [
                    {"location": ".".join(str(part) for part in err.get("loc", ())),
                     "type": str(err.get("type", "value_error"))}
                    for err in exc.errors()
                ],
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        raw_detail: object = exc.detail
        if isinstance(raw_detail, dict):
            content: dict[str, object] = raw_detail
        else:
            content = {
                "code": f"HTTP_{exc.status_code}",
                "message": str(raw_detail),
            }
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "execution_engine.unhandled",
            extra={
                "event": "execution_engine.unhandled",
                "path": request.url.path,
                "correlation_id": getattr(request.state, "correlation_id", None),
            },
        )
        # The message is for the logs; the client gets a retryable 500 with
        # the correlation id - never an exception string, which is how
        # internal shapes leak and secrets travel.
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "The command failed inside the engine; retry is permitted.",
                "correlationId": getattr(request.state, "correlation_id", ""),
            },
        )

    app.include_router(health.router)
    app.include_router(internal.router)
    app.include_router(retention.router)
    app.include_router(enablement.router)
    # Part 16's review surface: read-only with respect to orders, and mounted
    # last because it is the one route an operator reaches for when a refusal
    # needs explaining - the command plane above must never depend on it.
    app.include_router(placement.router)
    # The incident read surface (Part 17) sits beside it for the same reason: it
    # explains refusals, it does not produce them. Mounted after the review
    # because an operator who cannot place an order wants the list of why.
    app.include_router(incidents_router.router)
    # Mounted with the same gate as the hub, so a disabled exposition is a 404
    # rather than a 200 of prose: "no scrape target" and "empty target" are
    # different facts and a monitoring pipeline should not have to read a body to
    # tell them apart. Production cannot reach this branch - config refuses to
    # parse OBSERVABILITY_ENABLED=false there.
    if settings.OBSERVABILITY_ENABLED:
        app.include_router(observability_router.router)
    return app


def _printable(candidate: str) -> bool:
    return all(32 <= ord(ch) < 127 for ch in candidate)


if __name__ == "__main__":
    settings = get_settings()
    # The same target the image names, and for the same reason (see
    # infrastructure/docker/execution-engine.Dockerfile): there is deliberately no
    # module-level ``app`` here, because constructing the app is where settings are
    # parsed and a refused configuration belongs at startup, not at import.
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.EXECUTION_ENGINE_HOST,
        port=settings.SERVICE_PORT,
        log_config=None,  # uvicorn's default logging would bypass the redaction pipeline
    )
