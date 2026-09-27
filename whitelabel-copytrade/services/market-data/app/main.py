"""Market data application factory.

Part 1 delivers ingestion of public reference prices into a shared Redis cache
plus the internal read API. Streaming (websocket fan-out to the Node gateway)
is gated behind MARKET_DATA_STREAMING_ENABLED and lands with the trading work.
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
from app.observability import MarketDataObservability
from app.routers import health, market, observability
from app.services.poller import QuotePoller
from app.services.quote_cache import QuoteCache
from app.tracing import (
    TRACE_ID_RESPONSE_HEADER,
    finish_request_span,
    response_trace_header,
    start_request_span,
)

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "x-request-id"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    client = aioredis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD or None,
        db=settings.REDIS_DB,
        ssl=settings.REDIS_TLS,
        socket_connect_timeout=5.0,
        decode_responses=True,
    )
    app.state.redis = client

    hub: MarketDataObservability | None = None
    if settings.OBSERVABILITY_ENABLED:
        hub = MarketDataObservability(settings, client)

    poller = QuotePoller(
        settings,
        QuoteCache(settings, client),
        observer=hub.record_cycle if hub is not None else None,
    )
    app.state.poller = poller
    poller.start()

    if hub is not None:
        app.state.observability = hub
        app.state.tracer = hub.tracer
        hub.start()

    logger.info(
        "service.started",
        extra={
            "event": "service.started",
            "version": __version__,
            "environment": settings.NODE_ENV,
            "symbols": settings.symbols,
            "sources": settings.sources,
            "poll_interval_seconds": settings.MARKET_DATA_POLL_INTERVAL_SECONDS,
        },
    )

    try:
        yield
    finally:
        await poller.stop()
        if hub is not None:
            await hub.stop()
        await client.aclose()
        logger.info("service.stopped", extra={"event": "service.stopped"})


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    app = FastAPI(
        title="White-Label Copy Trading - Market Data",
        description=(
            "Internal reference-price service. Every route requires the shared "
            "internal service token; no user or credential data passes through it."
        ),
        version=__version__,
        lifespan=lifespan,
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
            detail if isinstance(detail, dict) else {"code": "HTTP_ERROR", "message": str(detail)}
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
    app.include_router(market.router)

    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.MARKET_DATA_HOST,
        port=settings.MARKET_DATA_PORT,
        log_config=None,
        access_log=False,
        reload=not settings.is_production,
    )


if __name__ == "__main__":
    main()
