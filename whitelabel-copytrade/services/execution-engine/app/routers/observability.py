"""The scrape endpoint (Part 18): one route, no tenant, no token.

Auth posture, deliberately the same as the two sibling services': ``/metrics``
follows the health endpoints it sits beside - unauthenticated, internal-network
only, machine-shaped aggregates with no tenant rows and no credentials. Two
reasons, both load-bearing:

* A Prometheus scraper and a compose healthcheck cannot be expected to hold the
  service token, and inventing a second credential for observability is how a
  deployment ends up either unable to scrape or shipping the token in the scrape
  config - the same outcome, reached slowly.
* There is nothing here worth stealing. The label law in the core
  (``FORBIDDEN_LABEL_NAMES``) rejects tenant, account, order and credential labels
  at registration, so the rendered text is aggregate counts, fixed-bucket
  histograms and five wiring booleans. The part's test suite asserts that on the
  rendered body as well as at registration, because a policy enforced only at the
  source is a policy that one new ``register_counter`` call can break.

The route answers with a comment line rather than a 500 in the one case where the
hub is genuinely absent: a request that races the lifespan. That is a window of a
few milliseconds per process start, and an empty scrape is more useful to a
pipeline than a 500 it has to special-case. ``OBSERVABILITY_ENABLED=false`` is a
different state and gets a different answer - the route is not mounted, so the
target 404s, because "no target" and "empty target" are different facts and a
scraper should not have to read a body to tell them apart.
"""

from __future__ import annotations

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
