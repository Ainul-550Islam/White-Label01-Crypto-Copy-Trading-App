"""Trading engine application factory.

Part 1 delivers the service skeleton, its security boundary, its health
surface and the pre-trade risk engine. Order routing is intentionally absent:
the platform ships the safety layer first, and `EXECUTION_ENABLED` stays false
until real exchange integration is reviewed and signed off.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from wlct_trading.observability.tracing import use_span

from app import __version__
from app.config import get_settings
from app.logging_config import configure_logging
from app.observability import TradingEngineObservability
from app.routers import engine, health, observability
from app.tracing import (
    TRACE_ID_RESPONSE_HEADER,
    finish_request_span,
    response_trace_header,
    start_request_span,
)

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "x-request-id"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    hub: TradingEngineObservability | None = None
    redis_client: aioredis.Redis | None = None
    if settings.OBSERVABILITY_ENABLED:
        # A dedicated short-lived-per-process client: the hub's mirror loop
        # must not compete with the request-path probes in app.services.
        redis_client = aioredis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            db=settings.REDIS_DB,
            ssl=settings.REDIS_TLS,
            socket_connect_timeout=5.0,
            decode_responses=True,
        )
        hub = TradingEngineObservability(settings, redis_client)
        _app.state.observability = hub
        _app.state.tracer = hub.tracer
        hub.start()

    logger.info(
        "service.started",
        extra={
            "event": "service.started",
            "version": __version__,
            "environment": settings.NODE_ENV,
            "execution_enabled": settings.EXECUTION_ENABLED,
            "sandbox_mode": settings.EXCHANGE_SANDBOX_MODE,
            "exchanges": settings.enabled_exchanges,
        },
    )

    if settings.EXECUTION_ENABLED and settings.is_production and settings.EXCHANGE_SANDBOX_MODE:
        # Contradictory configuration: loud warning rather than silent surprise.
        logger.warning(
            "config.contradiction",
            extra={
                "event": "config.contradiction",
                "detail": "EXECUTION_ENABLED is true while EXCHANGE_SANDBOX_MODE is also true",
            },
        )

    try:
        yield
    finally:
        if hub is not None:
            await hub.stop()
        if redis_client is not None:
            await redis_client.aclose()

    logger.info("service.stopped", extra={"event": "service.stopped"})


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    app = FastAPI(
        title="White-Label Copy Trading - Trading Engine",
        description=(
            "Internal execution and risk service. Not exposed publicly; every route "
            "requires the shared internal service token."
        ),
        version=__version__,
        lifespan=lifespan,
        # Interactive docs are disabled outside development: this service has no
        # business advertising its surface in a production network.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    @app.middleware("http")
    async def correlation_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Propagates the API's request id so traces span both services.

        Part 10 layers the W3C context on top of that seam: an inbound
        ``traceparent`` continues the trace, a malformed one is ignored (a
        fresh root, never a join on trust), and the response carries
        ``x-trace-id`` so an operator holding a request id can find the trace.
        With tracing disabled the middleware allocates nothing beyond the
        request id it always made.
        """
        request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        request.state.request_id = request_id

        tracer = getattr(request.app.state, "tracer", None)
        span = start_request_span(
            tracer,
            method=request.method,
            path=request.url.path,
            headers=dict(request.headers),
        )
        if span is None:
            response = await call_next(request)
        else:
            with use_span(span):
                response = await call_next(request)
            finish_request_span(span, status_code=response.status_code)
            trace_id = response_trace_header(span)
            if trace_id is not None:
                response.headers[TRACE_ID_RESPONSE_HEADER] = trace_id
        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "The submitted data failed validation.",
                    "details": [
                        {
                            "field": ".".join(str(part) for part in error["loc"][1:]),
                            "message": error["msg"],
                        }
                        for error in exc.errors()
                    ],
                    "requestId": getattr(request.state, "request_id", None),
                },
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        payload = (
            detail
            if isinstance(detail, dict)
            else {"code": "HTTP_ERROR", "message": str(detail)}
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {**payload, "requestId": getattr(request.state, "request_id", None)},
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        # The message is logged, never returned: it can contain internals.
        logger.exception(
            "request.unhandled_error",
            extra={
                "event": "request.unhandled_error",
                "error_type": type(exc).__name__,
                "path": request.url.path,
            },
        )
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": {
                    "code": "INTERNAL_SERVER_ERROR",
                    "message": "An unexpected error occurred.",
                    "requestId": getattr(request.state, "request_id", None),
                },
            },
        )

    app.include_router(health.router)
    app.include_router(observability.router)
    app.include_router(engine.router)

    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.TRADING_ENGINE_HOST,
        port=settings.TRADING_ENGINE_PORT,
        log_config=None,
        access_log=False,
        reload=not settings.is_production,
    )


if __name__ == "__main__":
    main()
