"""Prometheus exposition and the component-health view.

Why these are public (like /health) and /market is not: a metrics scrape
reveals only bounded counters and gauges - no tenant data, no symbol
business beyond aggregate ages - and scrapers and orchestrators cannot be
expected to hold the service token. The service is only reachable on the
internal network (docker-compose exposes no port), the same posture the
health endpoints have always had. The rendered text is machine-checked
against the platform's cardinality policy in CI (no order ids, no request
ids, no credentials - the registry refuses them at the source).

Both routes answer even before the lifespan completes: an empty scrape is
more useful to a monitoring pipeline than a 500, and the health view
reports UNKNOWN, which is the truth during startup.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from app.schemas import COMPONENTS_MEDIA_TYPE, PROMETHEUS_MEDIA_TYPE

router = APIRouter(tags=["observability"])


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def metrics(request: Request) -> PlainTextResponse:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return PlainTextResponse(
            "# observability not initialised in this process\n",
            media_type=PROMETHEUS_MEDIA_TYPE,
        )
    return PlainTextResponse(hub.scrape(), media_type=PROMETHEUS_MEDIA_TYPE)


@router.get("/health/components", include_in_schema=False)
async def components(request: Request) -> dict[str, object]:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return {
            "status": "UNKNOWN",
            "components": [],
            "reason": "observability hub not started",
            "media": COMPONENTS_MEDIA_TYPE,
        }
    document: dict[str, object] = hub.components_document()
    return document
