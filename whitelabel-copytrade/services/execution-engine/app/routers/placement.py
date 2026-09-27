"""The placement-review surface (Part 16): ask the venue's permission, place nothing.

One route, on the same internal plane as everything else here - same token, same
tenant-header match, absent from anything the public API proxies. It exists
because the review runs on every order and an operator otherwise learns its
answer only when an order has already been refused: this is the endpoint that
answers "would it be permitted" while the account is idle, which is the only
moment at which a refusal is cheap.

What it does NOT do is place, cancel, or amend an order. There is no
quantity, price or side in the request body, and the response carries a literal
``transmitted: false`` so a client can assert the absence rather than trust this
sentence. The endpoint spends venue weight (the review is one authenticated
metadata call, two with an account reader) and that is the whole of its effect
on the exchange.

Two refusals worth naming:

* ``409 PLACEMENT_REVIEW_UNWIRED`` - a runtime with no reviewer cannot answer the
  question. Reporting "not allowed" would be inventing a verdict; the honest
  answer is that this process has no review to consult. ``build_runtime`` makes
  this state unreachable today, and the check stays because the day it is
  reachable is the day somebody needs to see exactly this.
* ``400 PLACEMENT_REQUEST_REFUSED`` - a symbol, order type or time-in-force the
  review contract will not accept. The request, not the order, is what is wrong.

A ``allowed: false`` response is NOT an HTTP error, for the same reason Part 15
does not turn a FAIL grade into a 500: the review completed, and its answer is
the finding. An error status would hide the evidence in the transport and teach
whoever scripts this endpoint to treat a refusal as an outage.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from wlct_trading.execution.placement_attestor import PlacementReviewRequest
from wlct_trading.execution.placement_review import PlacementVerdict, ReviewFinding

from app.placement import PlacementWiring, review_placement
from app.schemas import (
    PlacementAttestRequest,
    PlacementAttestResponse,
    PlacementFindingView,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["placement"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]


def _view(verdict: PlacementVerdict, wiring: PlacementWiring) -> PlacementAttestResponse:
    """Render a verdict as the response model, field by field.

    Explicit rather than ``**verdict.to_dict()`` because a dict-splat wire model
    accepts whatever the core happens to emit today and quietly drops whatever it
    renames tomorrow: assembling the view means a renamed field is a broken test
    in this repository instead of a missing column on an operator's screen. The
    one exception is ``payload``, which is deliberately the core's own dict - it
    is the same object the durable order event carries, and re-spelling it here
    would create a second copy of a contract that has to stay one.
    """
    description = wiring.describe()
    return PlacementAttestResponse(
        allowed=verdict.allowed,
        verdict_id=verdict.verdict_id,
        codes=list(verdict.codes),
        blocking_codes=list(verdict.blocking_codes),
        retryable=verdict.retryable,
        venue_backed=verdict.venue_backed,
        venue_trading_permitted=verdict.venue_trading_permitted,
        no_known_withdrawal_path=verdict.no_known_withdrawal_path,
        review_required_at_micros=verdict.review_required_at_micros,
        attested_at_micros=verdict.attested_at_micros,
        summary=verdict.summary,
        findings=[_finding_view(finding) for finding in verdict.findings],
        payload=dict(verdict.to_event_payload()),
        transmitted=False,
        mode=str(description.get("mode", wiring.mode)),
        attestor_source=str(description.get("attestorSource", "unavailable")),
    )


def _finding_view(finding: ReviewFinding) -> PlacementFindingView:
    return PlacementFindingView(
        code=finding.code.value,
        severity=finding.severity.value,
        field=finding.field_name,
        message=finding.message,
    )


@router.post(
    "/placement/attest",
    response_model=PlacementAttestResponse,
    response_model_by_alias=True,
)
async def placement_attest(
    body: PlacementAttestRequest,
    caller: AuthDep,
    request: Request,
) -> PlacementAttestResponse:
    """Run the authenticated placement review for one would-be order."""
    require_tenant_match(body.tenant_id, caller)
    runtime = getattr(request.app.state, "runtime", None)
    wiring: PlacementWiring | None = getattr(runtime, "placement", None)
    if wiring is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "PLACEMENT_REVIEW_UNWIRED",
                "message": (
                    "this runtime has no placement reviewer, so there is no "
                    "review to report; refusing to answer 'allowed' or 'denied' "
                    "when nobody asked the venue would be the one thing this "
                    "endpoint must never do"
                ),
            },
        )
    try:
        review_request = PlacementReviewRequest(
            tenant_id=body.tenant_id,
            account_id=body.account_id,
            symbol=body.symbol,
            order_type=body.order_type,
            time_in_force=body.time_in_force,
        )
    except ValueError as refused:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "PLACEMENT_REQUEST_REFUSED",
                "message": f"{refused} (docs/PART16_PLACEMENT_REVIEW.md)",
            },
        ) from None
    _, verdict = await review_placement(
        wiring,
        tenant_id=review_request.tenant_id,
        account_id=review_request.account_id,
        symbol=review_request.symbol,
        order_type=review_request.order_type,
        time_in_force=review_request.time_in_force,
    )
    return _view(verdict, wiring)
