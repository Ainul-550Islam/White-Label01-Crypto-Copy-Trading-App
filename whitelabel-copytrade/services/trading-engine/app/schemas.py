"""Wire contracts.

These mirror the TypeScript definitions in ``packages/shared-types`` so the API
and the engine cannot drift. Anything money-shaped is a ``Decimal`` and is
serialised as a string; floats are never used for balances or prices.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP_MARKET = "STOP_MARKET"
    STOP_LIMIT = "STOP_LIMIT"


class ExchangeId(str, Enum):
    BINANCE = "binance"
    BYBIT = "bybit"
    OKX = "okx"
    KRAKEN = "kraken"
    COINBASE = "coinbase"


class EngineStatus(str, Enum):
    IDLE = "IDLE"
    READY = "READY"
    EXECUTION_DISABLED = "EXECUTION_DISABLED"
    DEGRADED = "DEGRADED"


class BaseSchema(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


class HealthResponse(BaseSchema):
    status: str
    service: str = "trading-engine"
    version: str
    environment: str
    execution_enabled: bool = Field(alias="executionEnabled")
    sandbox_mode: bool = Field(alias="sandboxMode")
    uptime_seconds: int = Field(alias="uptimeSeconds")
    checked_at: datetime = Field(
        alias="checkedAt", default_factory=lambda: datetime.now(UTC)
    )


class DependencyHealth(BaseSchema):
    name: str
    healthy: bool
    latency_ms: float | None = Field(default=None, alias="latencyMs")
    detail: str | None = None


class ReadinessResponse(BaseSchema):
    status: str
    dependencies: list[DependencyHealth]
    checked_at: datetime = Field(
        alias="checkedAt", default_factory=lambda: datetime.now(UTC)
    )


class ExchangeCapability(BaseSchema):
    exchange: ExchangeId
    enabled: bool
    supports_spot: bool = Field(alias="supportsSpot")
    supports_futures: bool = Field(alias="supportsFutures")
    supports_sandbox: bool = Field(alias="supportsSandbox")
    requires_passphrase: bool = Field(alias="requiresPassphrase")
    #: Documented rate limit, used by the scheduler to pace requests.
    rate_limit_per_minute: int = Field(alias="rateLimitPerMinute")


class EngineStatusResponse(BaseSchema):
    status: EngineStatus
    execution_enabled: bool = Field(alias="executionEnabled")
    sandbox_mode: bool = Field(alias="sandboxMode")
    exchanges: list[ExchangeCapability]
    risk_limits: RiskLimits = Field(alias="riskLimits")


class RiskLimits(BaseSchema):
    max_order_notional_usd: Decimal = Field(alias="maxOrderNotionalUsd")
    max_open_positions_per_account: int = Field(alias="maxOpenPositionsPerAccount")
    max_leverage: int = Field(alias="maxLeverage")


class OrderIntent(BaseSchema):
    """A proposed order, before any risk decision has been taken."""

    tenant_id: str = Field(alias="tenantId", min_length=1, max_length=64)
    account_id: str = Field(alias="accountId", min_length=1, max_length=64)
    exchange: ExchangeId
    symbol: str = Field(min_length=3, max_length=24, pattern=r"^[A-Z0-9]+[-/]?[A-Z0-9]+$")
    side: OrderSide
    order_type: OrderType = Field(alias="orderType")
    quantity: Decimal = Field(gt=Decimal("0"))
    price: Decimal | None = Field(default=None, gt=Decimal("0"))
    leverage: int = Field(default=1, ge=1, le=125)
    reduce_only: bool = Field(default=False, alias="reduceOnly")
    client_order_id: str | None = Field(default=None, alias="clientOrderId", max_length=64)


class RiskDecision(BaseSchema):
    """The engine's verdict on an order intent."""

    approved: bool
    reasons: list[str]
    execution_enabled: bool = Field(alias="executionEnabled")
    would_execute: bool = Field(alias="wouldExecute")
    evaluated_at: datetime = Field(
        alias="evaluatedAt", default_factory=lambda: datetime.now(UTC)
    )


EngineStatusResponse.model_rebuild()
