"""The incident read surface (Part 17): look at what the engine needed a human for.

One route, on the same internal plane as the placement review - same token, same
tenant-header match, absent from anything the public API proxies and from the
worker's forwarding path list. It exists because a durable incident table that
nothing can read is a filing cabinet: Part 13 made orders survive a restart,
Part 17 makes the explanation survive with them, and an operator with no way to
ask the second question has only the log files.

The route reads and writes nothing. There is no resolve verb here on purpose -
``ExecutionIncident`` is immutable and the core's law is that closing an incident
means recording a new one, so an endpoint that flipped ``resolved`` would be the
first mutable thing in an audit trail.

Two refusals worth naming:

* ``503 INCIDENT_STORE_UNREADABLE`` - the sink could not answer. An empty list is
  the one response more misleading than an error, because "no open incidents" is
  what a healthy system looks like; the durable store's own law is that a failed
  read is said out loud.
* ``422`` from the request model - a limit outside 1..1000 or a tenant the header
  disagrees with. The bound is the store's, so nobody can turn an operator endpoint
  into a full-table scan by asking nicely.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from wlct_trading.execution.incidents import ExecutionIncident, IncidentRecorder

from app.incidents_sql import IncidentReadError
from app.schemas import IncidentListRequest, IncidentListResponse, IncidentView
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["incidents"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]


def _view(incident: ExecutionIncident) -> IncidentView:
    """Render one record from its own fields rather than from ``to_dict()``.

    Reading a ``dict[str, object]`` would mean casting fifteen values, and a cast
    is where a type error goes to hide; the dataclass attributes are the typed
    source. What keeps the two spellings honest is a test that the view's field set
    equals ``ExecutionIncident.to_dict()``'s key set, so a rename on either side is
    a broken test in this repository instead of a missing column on a screen - the
    property the dict-splat would have given, without the casting.
    """
    return IncidentView(
        incident_id=incident.incident_id,
        tenant_id=incident.tenant_id,
        account_id=incident.account_id,
        type=incident.incident_type.value,
        severity=incident.severity.value,
        summary=incident.summary,
        exchange=incident.exchange.value if incident.exchange else None,
        symbol=incident.symbol,
        order_id=incident.order_id,
        client_order_id=incident.client_order_id,
        error_code=incident.error_code.value if incident.error_code else None,
        details={str(key): str(value) for key, value in incident.details.items()},
        occurred_at_micros=incident.occurred_at_micros,
        resolved=incident.resolved,
        resolution_note=incident.resolution_note,
    )


@router.post(
    "/incidents/list",
    response_model=IncidentListResponse,
    response_model_by_alias=True,
)
async def incidents_list(
    body: IncidentListRequest,
    caller: AuthDep,
    request: Request,
) -> IncidentListResponse:
    """Open incidents for one tenant, newest first."""
    require_tenant_match(body.tenant_id, caller)
    runtime = getattr(request.app.state, "runtime", None)
    recorder: IncidentRecorder | None = getattr(runtime, "incidents", None)
    if recorder is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "INCIDENT_SINK_UNWIRED",
                "message": (
                    "this runtime has no incident sink, so it has no incidents to "
                    "report; answering 'none' would be indistinguishable from the "
                    "system being healthy, which is the one thing this endpoint "
                    "must never be"
                ),
            },
        )
    try:
        found = await recorder.list_open(body.tenant_id, limit=body.limit)
    except (IncidentReadError, RuntimeError) as failed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "INCIDENT_STORE_UNREADABLE",
                "message": f"{failed}",
            },
        ) from None
    rows = [
        _view(incident)
        for incident in found
        if body.account_id is None or incident.account_id == body.account_id
    ]
    return IncidentListResponse(
        tenant_id=body.tenant_id,
        source=type(recorder).__name__,
        durable=bool(getattr(recorder, "is_durable", False)),
        limit=body.limit,
        returned=len(rows),
        incidents=rows,
    )
