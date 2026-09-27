"""Market data wire contracts."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class BaseSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True, extra="forbid")


class HealthResponse(BaseSchema):
    status: str
    service: str = "market-data"
    version: str
    environment: str
    streaming_enabled: bool = Field(alias="streamingEnabled")
    tracked_symbols: int = Field(alias="trackedSymbols")
    uptime_seconds: int = Field(alias="uptimeSeconds")
    checked_at: datetime = Field(
        alias="checkedAt", default_factory=lambda: datetime.now(timezone.utc)
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
        alias="checkedAt", default_factory=lambda: datetime.now(timezone.utc)
    )


#: Content types the observability routes serve. Constants, so the router
#: and its tests cannot disagree about ``version=0.0.4`` or the charset.
PROMETHEUS_MEDIA_TYPE = "text/plain; version=0.0.4; charset=utf-8"
COMPONENTS_MEDIA_TYPE = "application/json"


class Quote(BaseSchema):
    """A single reference price.

    `stale` is explicit rather than implied: a consumer must be able to tell a
    fresh quote from a cached one without guessing from timestamps, because a
    stale price must never be used to value an order.
    """

    symbol: str
    source: str
    bid: Decimal | None = None
    ask: Decimal | None = None
    last: Decimal
    volume_24h: Decimal | None = Field(default=None, alias="volume24h")
    change_24h_pct: Decimal | None = Field(default=None, alias="change24hPct")
    stale: bool = False
    as_of: datetime = Field(alias="asOf")


class QuoteListResponse(BaseSchema):
    quotes: list[Quote]
    retrieved_at: datetime = Field(
        alias="retrievedAt", default_factory=lambda: datetime.now(timezone.utc)
    )


class SymbolListResponse(BaseSchema):
    symbols: list[str]
    sources: list[str]
    poll_interval_seconds: int = Field(alias="pollIntervalSeconds")
    streaming_enabled: bool = Field(alias="streamingEnabled")
