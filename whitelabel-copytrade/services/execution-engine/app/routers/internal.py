"""The internal command surface the trading worker forwards to.

Contract notes that the worker and the API both depend on:

* 200 means DURABLY PROCESSED (for the runtime's durability class); the
  business verdict rides in the body (`outcome`, `verified`), never in the
  status code. A rejected cancel and a completed cancel are both 200 -
  the job is done when we have a confident answer about it, which is
  exactly the BullMQ ack boundary.
* 4xx here is never retried: 401/403 is wiring wrong, 422 is a payload
  that cannot be executed by anyone, 404 says the record this command
  acts on does not exist in this runtime's store. 501 says "supported by
  the queue contract, not wired in this build" - the honest answer for
  resync-private-stream today.
* 5xx is retryable by contract; the worker defers the job.
* every response carries the correlation ids back so the worker can log
  one line per command that both sides can grep for.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.composition import EngineRuntime
from app.routers.health import get_runtime
from app.schemas import (
    AccountCommandRequest,
    BalancesResponse,
    BalanceView,
    CancelOrderRequest,
    CancelOrderResponse,
    DiscrepancyView,
    IncidentSinkView,
    LiveEnablementView,
    PlacementStatusView,
    ReconcileResponse,
    StatusResponse,
    VerifyResponse,
)
from app.security import (
    ServiceCaller,
    require_internal_auth,
    require_internal_auth_readonly,
    require_tenant_match,
)

router = APIRouter(prefix="/internal/v1", tags=["internal"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]
RuntimeDep = Annotated[EngineRuntime, Depends(get_runtime)]

#: The read scope (Part 20), on the one route in this file that acts on nothing. The
#: reason it exists is a defect this part found by RUNNING the composition rather than
#: reading it: the worker's startup gate calls ``GET /internal/v1/status`` with no
#: tenant header - correctly, since a process-level read has no tenant to name - and
#: ``require_internal_auth`` answered it with 400 TENANT_HEADER_REQUIRED, which is not a
#: terminal status, so `src/worker.ts` logged "execution engine gate failed" and exited
#: 1. The reference deployment could not start its worker, and nothing in the suites
#: noticed for nine parts because every test of that gate stubs ``fetch``. The fix had to
#: be on this side of the boundary: a client cannot answer a tenant law by inventing a
#: tenant, and the alternative - having the gate read the unauthenticated
#: ``/health/ready`` instead - would base an assert-before-forward decision on a
#: document any peer can forge.
ReadAuthDep = Annotated[ServiceCaller, Depends(require_internal_auth_readonly)]


@router.get("/status", response_model=StatusResponse, response_model_by_alias=True)
async def engine_status(
    # The tenant is not consulted below, and that is the argument for this dependency
    # rather than `AuthDep`: the route reads the process, not a tenant's rows.
    caller: ReadAuthDep,
    runtime: RuntimeDep,
    request: Request,
) -> StatusResponse:
    """The worker asserts `mode`/`store`/`commands` against its own config
    before forwarding anything; a deployment that disagrees is refused at
    the worker boundary rather than discovered mid-command."""
    wiring = runtime.describe()
    placement = wiring.get("placement")
    return StatusResponse(
        instance_id=str(wiring["instanceId"] or ""),
        mode=str(wiring["mode"]),
        dry_run=bool(wiring["dryRun"]),
        adapter=str(wiring["adapter"]),
        store=str(wiring["store"]),
        store_durable=bool(wiring["storeDurable"]),
        store_backend=str(wiring["storeBackend"]),
        retention_enabled=bool(wiring["retentionEnabled"]),
        retention_event_days=int(wiring["retentionEventDays"]),
        enablement_max_age_days=int(wiring["enablementMaxAgeDays"]),
        credential_source=str(wiring["credentialSource"]),
        # A KeyError here is the intended behaviour, not a bug to guard: the key is
        # published by ``describe()`` above, and a composition that stopped
        # publishing it should fail this route loudly rather than answer "false"
        # about a field it no longer reports.
        metrics_configured=bool(wiring["metricsConfigured"]),
        # Read with ``[]``, not ``get``: these keys are published by describe()
        # above, and a status route that defaulted them would answer a question this
        # process stopped asking.
        credential_fetcher=wiring["credentialFetcher"],
        operator_confirmation=bool(wiring["operatorConfirmation"]),
        live_enablement=(
            None
            if wiring["liveEnablement"] is None
            else LiveEnablementView(**wiring["liveEnablement"])
        ),
        # Validated through the view rather than passed through as a dict: the
        # keys below are the contract, so a describe() that starts publishing
        # something new fails here (and in the drift test) instead of quietly
        # publishing an unreviewed field on an authenticated internal surface.
        placement=None if placement is None else PlacementStatusView(**placement),
        # Part 17's block, mapped through its typed view for the same reason the
        # placement block is: a describe() that starts publishing something else is
        # a decision to be made here, not an unreviewed field on an internal
        # caller's screen - and "why is the incident list empty" is exactly the
        # question this route exists to answer without shell access.
        incidents=(
            None
            if wiring.get("incidents") is None
            else IncidentSinkView(**wiring["incidents"])
        ),
        locks_distributed=bool(wiring["locksDistributed"]),
        # Part 20: signed transport posture, mapped from describe() for the same
        # reason every other field is: the worker asserts against this surface.
        signed_transport_wired=bool(wiring.get("signedTransportWired", False)),
        key_registry_configured=bool(wiring.get("keyRegistryConfigured", False)),
        # Part 21: distributed lock wiring posture.
        distributed_lock_wiring=wiring.get("distributedLockWiring"),
        # Part 22: venue attestation posture.
        venue_attestation=wiring.get("venueAttestation"),
        # Part 23: credential registry posture.
        credential_registry=wiring.get("credentialRegistry"),
        commands=[str(command) for command in wiring["commands"]],
    )


@router.post(
    "/accounts/verify-credentials",
    response_model=VerifyResponse,
    response_model_by_alias=True,
)
async def verify_credentials(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> VerifyResponse:
    require_tenant_match(body.tenant_id, caller)
    ok, note = await runtime.account_adapter.verify_credentials(
        body.tenant_id, body.account_id
    )
    return VerifyResponse(verified=ok, note=note, is_simulated=True)


@router.post(
    "/accounts/refresh-balances",
    response_model=BalancesResponse,
    response_model_by_alias=True,
)
async def refresh_balances(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> BalancesResponse:
    require_tenant_match(body.tenant_id, caller)
    balances = await runtime.account_adapter.fetch_balances(
        body.tenant_id, body.account_id
    )
    return BalancesResponse(
        balances=[
            BalanceView(asset=row.asset, free=str(row.free), locked=str(row.locked))
            for row in balances
        ],
        is_simulated=True,
    )


@router.post(
    "/accounts/reconcile",
    response_model=ReconcileResponse,
    response_model_by_alias=True,
)
async def reconcile_account(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> ReconcileResponse:
    require_tenant_match(body.tenant_id, caller)
    report = await runtime.reconciliation.reconcile_account(
        body.tenant_id, body.account_id
    )
    return ReconcileResponse(
        tenant_id=report.tenant_id,
        account_id=report.account_id,
        exchange=report.exchange.value,
        orders_checked=report.orders_checked,
        fills_recovered=report.fills_recovered,
        discrepancy_count=len(report.discrepancies),
        discrepancies=[
            DiscrepancyView(
                discrepancy_type=discrepancy.discrepancy_type.value,
                summary=discrepancy.summary,
                order_id=discrepancy.order_id,
                repaired=discrepancy.repaired,
            )
            for discrepancy in report.discrepancies
        ],
        error=report.error,
        started_at_micros=report.started_at_micros,
        finished_at_micros=report.finished_at_micros,
    )


@router.post(
    "/accounts/resync-private-stream",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def resync_private_stream(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> dict[str, Any]:
    """Not wired in the simulated build, and the refusal is the feature.

    A private-stream resync is a LIVE venue interaction (new listen key,
    reconnect, catch-up reconcile). Simulated execution has no stream to
    resync; pretending to accept the command would turn the API's honest
    202 "queued for the worker" into a lie three hops later. The job fails
    visibly with a reason an operator can read.
    """
    require_tenant_match(body.tenant_id, caller)
    return {
        "code": "NOT_SUPPORTED",
        "message": (
            "resync-private-stream requires the live venue adapter (Part 12); "
            "this runtime is simulated and has no private stream to resync."
        ),
    }


@router.post("/orders/cancel", response_model=CancelOrderResponse, response_model_by_alias=True)
async def cancel_order(
    body: CancelOrderRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> CancelOrderResponse:
    require_tenant_match(body.tenant_id, caller)
    order = await runtime.store.get_order(body.tenant_id, body.order_id)
    if order is None:
        # 404, not a fabricated rejection: this runtime has no record of
        # the order, so it must not claim an outcome about it. The worker's
        # job fails visibly; the API-side order state never moves.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "ORDER_NOT_FOUND",
                "message": (
                    "This runtime holds no record of that order; refusing to "
                    "report a cancellation outcome for an order it cannot see."
                ),
            },
        )
    if order.client_order_id != body.client_order_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ORDER_IDENTITY_MISMATCH",
                "message": (
                    "The order record does not carry the client order id the "
                    "command named; the job is refused rather than aimed at a "
                    "different order."
                ),
            },
        )
    result = await runtime.engine.cancel(order)
    return CancelOrderResponse(
        outcome=result.outcome.value,
        client_order_id=result.client_order_id or body.client_order_id,
        order_status=result.order.status.value if result.order is not None else "UNKNOWN",
        error_code=result.error_code.value if result.error_code is not None else None,
        message=result.message,
        latency_micros=result.latency_micros,
        is_simulated=result.is_simulated,
    )
