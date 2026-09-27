"""Metrics exposition, component health and the trading-plane gate view.

Auth posture, deliberately asymmetric:

* ``/metrics`` and ``/health/components`` follow the health endpoints they
  extend - unauthenticated, internal-network-only, machine-shaped aggregates
  with no tenant rows and no credentials (the registry rejects such labels at
  the source; the CI safety spec checks the rendered text too).
* ``/health/trading`` is ALSO the trading engine telling the API what it can
  prove about trading safety, gate by gate. It reports; it never authorises:
  the authoritative merge and the enforcement live elsewhere (API merge and
  the risk gate respectively), and the response says so in its ``note``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["observability"])

PROMETHEUS_MEDIA_TYPE = "text/plain; version=0.0.4; charset=utf-8"


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
async def components(request: Request) -> dict[str, Any]:
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return {
            "status": "UNKNOWN",
            "components": [],
            "reason": "observability hub not started",
        }
    document: dict[str, Any] = hub.components_document()
    return document


@router.get("/health/trading", include_in_schema=False)
async def trading_gates(request: Request) -> dict[str, Any]:
    """This service's subset of the nine trading gates (see module docstring).

    Always 200 with the verdict inside: this is a reporting endpoint, and
    HTTP-status semantics on it would tempt a load balancer to remove a node
    that is accurately reporting "not ready" - which is exactly when the
    operator is most needed at it.
    """
    hub = getattr(request.app.state, "observability", None)
    if hub is None:
        return {
            "component": "trading-engine",
            "gatesSatisfied": False,
            "gates": [],
            "note": "observability hub not started; trading remains blocked",
        }
    document: dict[str, Any] = hub.readiness_view()
    return document
