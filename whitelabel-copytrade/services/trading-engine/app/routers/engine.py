"""Engine control surface.

Every route requires the internal service token: the trading engine is a
private component and must never be reachable by a browser or a mobile client.
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import Settings, get_settings
from app.schemas import (
    EngineStatus,
    EngineStatusResponse,
    OrderIntent,
    RiskDecision,
    RiskLimits,
)
from app.security import ServiceCaller, require_internal_auth
from app.services.exchange_registry import ExchangeRegistry
from app.services.risk_engine import RiskEngine

router = APIRouter(prefix="/v1/engine", tags=["engine"])


def get_registry(settings: Annotated[Settings, Depends(get_settings)]) -> ExchangeRegistry:
    return ExchangeRegistry(settings)


def get_risk_engine(
    settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[ExchangeRegistry, Depends(get_registry)],
) -> RiskEngine:
    return RiskEngine(settings, registry)


@router.get("/status", response_model=EngineStatusResponse, response_model_by_alias=True)
async def engine_status(
    caller: Annotated[ServiceCaller, Depends(require_internal_auth)],
    settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[ExchangeRegistry, Depends(get_registry)],
) -> EngineStatusResponse:
    """Reports capability and configuration, scoped to the calling tenant."""
    _ = caller  # The tenant scope is enforced by the dependency itself.

    return EngineStatusResponse(
        status=(
            EngineStatus.READY
            if settings.EXECUTION_ENABLED
            else EngineStatus.EXECUTION_DISABLED
        ),
        executionEnabled=settings.EXECUTION_ENABLED,
        sandboxMode=settings.EXCHANGE_SANDBOX_MODE,
        exchanges=registry.list_capabilities(),
        riskLimits=RiskLimits(
            maxOrderNotionalUsd=Decimal(str(settings.MAX_ORDER_NOTIONAL_USD)),
            maxOpenPositionsPerAccount=settings.MAX_OPEN_POSITIONS_PER_ACCOUNT,
            maxLeverage=settings.MAX_LEVERAGE,
        ),
    )


@router.post(
    "/risk/evaluate",
    response_model=RiskDecision,
    response_model_by_alias=True,
    status_code=status.HTTP_200_OK,
)
async def evaluate_risk(
    intent: OrderIntent,
    request: Request,
    caller: Annotated[ServiceCaller, Depends(require_internal_auth)],
    risk_engine: Annotated[RiskEngine, Depends(get_risk_engine)],
) -> RiskDecision:
    """Runs the pre-trade guard rails against a proposed order.

    This endpoint evaluates and reports. It never places an order, and it is
    reachable regardless of the execution kill switch precisely so operators can
    validate their risk configuration before enabling live trading.
    """
    if intent.tenant_id != caller.tenant_id:
        # The header is authoritative; a body that disagrees is an attempt to
        # act on another tenant's behalf.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "TENANT_MISMATCH",
                "message": "The order intent does not belong to the calling organisation.",
            },
        )

    started = time.perf_counter_ns()
    try:
        decision = risk_engine.evaluate(intent, reference_price=None)
    except HTTPException:
        # A refusal-with-status (auth, tenant mismatch upstream) is not an
        # internal fault; the error-rate SLO counts only exceptions that
        # reach the framework. Re-raise untouched.
        raise
    except Exception:
        hub_err = getattr(request.app.state, "observability", None)
        if hub_err is not None:
            hub_err.record_pretrade_error()
        raise
    hub = getattr(request.app.state, "observability", None)
    if hub is not None:
        # Observation only; the hub never mutates a decision, and a hub
        # failure can never change what was already computed.
        hub.record_pretrade(
            approved=decision.approved,
            duration_micros=int((time.perf_counter_ns() - started) // 1_000),
        )
    return decision
