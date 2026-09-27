"""The retention command surface (Part 14): inspect always, prune only when
the deployment has said so twice (endpoint reached AND
EXECUTION_RETENTION_ENABLED).

These two routes are the ONLY way journal rows ever get deleted, and they
are internal-plane by construction: same token authentication as every
other ``/internal/v1`` route, same tenant-header match (a body that names
another tenant's id is refused at the door, not "handled" downstream), and
deliberately absent from anything the public API proxies. The worker does
not forward here; the intended caller is a scheduler running the platform
retention script, one tenant per call.

Error-shape law, restated because the stakes differ: every refusal on this
surface is a 4xx that is NOT retried (the deployment configuration is the
thing to change), every store failure is a 5xx the caller will try again
against a still-consistent store (deletes are batched and the predicate is
idempotent: deleted rows stop matching it). The one shape with no clean
class is RETENTION_LEDGER_LOST - deletions happened, the record failed -
and it is answered 500 with the counts IN the body, because "unknown
outcome" on a deletion endpoint would force an operator to go read raw
database state at incident hours.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import get_settings
from app.retention import RetentionLedgerLost, inspect_event_store, run_event_retention
from app.schemas import (
    RetentionInspectRequest,
    RetentionInspectResponse,
    RetentionRunRequest,
    RetentionRunResponse,
    RetentionRunView,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["retention"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]

#: How many ledger rows inspect returns. A page, not a history - the
#: history is readable from the table by an operator with a psql session
#: and a purpose; an endpoint is not a query language.
INSPECT_RUN_LIMIT = 5


def _durable_pool(request: Request) -> Any:
    """The store's pool, or the refusal that says why retention is not
    available. Memory-mode runtimes HAVE no journal growth problem (the
    restart bounds them), which is exactly why this answer is 409-with-
    reasoning rather than an empty success."""
    pool = getattr(request.app.state, "store_pool", None)
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_NO_DURABLE_STORE",
                "message": (
                    "event retention prunes the durable journal; this runtime's store "
                    "is process memory, which restarts bound - there is nothing here to "
                    "prune, and answering a maintenance command as though there were is "
                    "the failure mode, not the fallback. Configure "
                    "EXECUTION_STORE_BACKEND=postgres (docs/PART13_DURABLE_STORE.md)."
                ),
            },
        )
    return pool


@router.post("/retention/run", response_model=RetentionRunResponse, response_model_by_alias=True)
async def retention_run(
    body: RetentionRunRequest,
    caller: AuthDep,
    request: Request,
) -> RetentionRunResponse:
    """Prune (or rehearse pruning) one tenant's settled journal rows."""
    require_tenant_match(body.tenant_id, caller)
    pool = _durable_pool(request)
    settings = get_settings()
    if not body.dry_run and not settings.EXECUTION_RETENTION_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_APPLY_DISABLED",
                "message": (
                    "this deployment is dry-run only: EXECUTION_RETENTION_ENABLED=false. "
                    "Inspect the answer first, confirm a fresh backup, then set the env "
                    "and restart - a data-deleting capability is never flipped by the "
                    "request that exercises it (docs/PART14_RETENTION.md)."
                ),
            },
        )
    report = None
    try:
        report = await run_event_retention(
            pool,
            body.tenant_id,
            settings.retention_policy,
            dry_run=body.dry_run,
            instance_id=str(settings.EXECUTION_INSTANCE_ID or ""),
        )
    except RetentionLedgerLost as lost:
        report = lost.report
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "RETENTION_LEDGER_LOST",
                "message": (
                    f"the prune completed ({report.rows_reported} rows, dry-run "
                    f"{str(report.dry_run).lower()}) but its ledger row failed to write; "
                    "this body is the only place those counts exist outside the log line "
                    "'retention.ledger_write_failed' - fix the store before scheduling "
                    "another run"
                ),
                "rowsReported": report.rows_reported,
                "cutoffUs": str(report.cutoff_us),
                "batchesRun": report.batches_run,
                "exhausted": report.exhausted,
            },
        ) from None
    return RetentionRunResponse(
        dry_run=report.dry_run,
        cutoff_us=report.cutoff_us,
        rows_reported=report.rows_reported,
        batches_run=report.batches_run,
        exhausted=report.exhausted,
        ledger_written=report.ledger_written,
    )


@router.post(
    "/retention/inspect",
    response_model=RetentionInspectResponse,
    response_model_by_alias=True,
)
async def retention_inspect(
    body: RetentionInspectRequest,
    caller: AuthDep,
    request: Request,
) -> RetentionInspectResponse:
    """What WOULD be pruned right now, and the last runs that were."""
    require_tenant_match(body.tenant_id, caller)
    pool = _durable_pool(request)
    settings = get_settings()
    view = await inspect_event_store(
        pool,
        body.tenant_id,
        settings.retention_policy,
        limit=INSPECT_RUN_LIMIT,
    )
    return RetentionInspectResponse(
        enabled=settings.EXECUTION_RETENTION_ENABLED,
        event_retention_days=settings.EXECUTION_RETENTION_EVENT_DAYS,
        batch_rows=settings.EXECUTION_RETENTION_BATCH_ROWS,
        max_batches=settings.EXECUTION_RETENTION_MAX_BATCHES,
        cutoff_us=view["cutoffUs"],
        prunable_now=view["prunableNow"],
        runs=[RetentionRunView(**row) for row in view["runs"]],
    )
