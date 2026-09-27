"""Configuration for the market data service."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    MARKET_DATA_HOST: str = "0.0.0.0"
    MARKET_DATA_PORT: int = Field(default=8002, ge=1, le=65535)
    MARKET_DATA_HEALTH_PATH: str = "/health"

    REDIS_HOST: str
    REDIS_PORT: int = Field(default=6379, ge=1, le=65535)
    REDIS_PASSWORD: str | None = None
    REDIS_DB: int = Field(default=0, ge=0, le=15)
    REDIS_TLS: bool = False

    INTERNAL_SERVICE_TOKEN: str = Field(min_length=32)

    #: Upstream venues polled for reference prices.
    MARKET_DATA_SOURCES: str = "binance,bybit"
    #: Symbols the service tracks. Kept explicit so a typo cannot fan out.
    MARKET_DATA_SYMBOLS: str = "BTC/USDT,ETH/USDT,SOL/USDT"
    MARKET_DATA_POLL_INTERVAL_SECONDS: int = Field(default=5, ge=1, le=300)
    #: How long a cached quote stays servable before it is considered stale.
    MARKET_DATA_CACHE_TTL_SECONDS: int = Field(default=15, ge=1, le=3600)
    #: Master switch for the live websocket feed. Off by default: a fresh
    #: deployment should not open venue connections until an operator asks for
    #: them.
    MARKET_DATA_STREAMING_ENABLED: bool = False

    # ------------------------------------------------------------------
    # Live public market data (wlct_trading.net)
    #
    # Public endpoints only. There is deliberately no API key or secret in
    # this class: public market data needs none, and user exchange credentials
    # live encrypted per trading account in PostgreSQL — never in a service's
    # environment.
    # ------------------------------------------------------------------
    BINANCE_WS_URL: str = "wss://stream.binance.com:9443"
    BINANCE_REST_URL: str = "https://api.binance.com"
    EXCHANGE_USE_TESTNET: bool = False

    #: Channels. Each maps to one stream per symbol on the shared connection.
    MARKET_DATA_TICKER_ENABLED: bool = True
    MARKET_DATA_TRADES_ENABLED: bool = True
    MARKET_DATA_ORDERBOOK_ENABLED: bool = True

    WEBSOCKET_CONNECT_TIMEOUT_MS: int = Field(default=10_000, ge=100, le=120_000)
    #: Backstop below the heartbeat, not the primary liveness check. Generous
    #: on purpose: a thin symbol's trade stream can legitimately be silent for
    #: minutes, and the venue's protocol pings are answered by the client
    #: library without ever surfacing as a message.
    WEBSOCKET_RECEIVE_TIMEOUT_MS: int = Field(default=300_000, ge=1_000, le=3_600_000)
    WEBSOCKET_HEARTBEAT_TIMEOUT_MS: int = Field(default=90_000, ge=2_000, le=600_000)

    HTTP_CONNECT_TIMEOUT_MS: int = Field(default=5_000, ge=100, le=120_000)
    HTTP_READ_TIMEOUT_MS: int = Field(default=10_000, ge=100, le=120_000)
    HTTP_TOTAL_TIMEOUT_MS: int = Field(default=15_000, ge=100, le=300_000)

    #: Duration of the separately invoked live smoke test. Not used by the
    #: service itself.
    LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS: int = Field(
        default=30, ge=1, le=3_600
    )

    # ------------------------------------------------------------------
    # Part 9: observability (metrics exposition, health mirror, alerting)
    #
    # These are *publication* switches, never trading switches: turning
    # observability off removes the panel the operator relies on and grants
    # nothing. Production refuses to parse with them off.
    # ------------------------------------------------------------------
    OBSERVABILITY_ENABLED: bool = True
    HEALTH_REFRESH_MS: int = Field(default=5_000, ge=500, le=60_000)

    # ------------------------------------------------------------------
    # Part 10: OpenTelemetry tracing and failure injection
    #
    # Same discipline as the Part 9 switches: these control what telemetry
    # LEAVES the process, never what this service does. Sampling decides
    # visibility, not authorisation; injection is a test-harness capability
    # that production configuration cannot arm at all (see the validator).
    # ------------------------------------------------------------------
    #: Master switch for span export. Off by default: an unconfigured
    #: endpoint must not turn every mirror tick into a connect timeout.
    OTEL_ENABLED: bool = False
    #: OTLP/HTTP base URL (spans are POSTed to <endpoint>/v1/traces as
    #: OTLP/JSON). Secret-free plain URLs only; credentials belong to the
    #: collector's own network position, never to this configuration.
    OTEL_ENDPOINT: str | None = None
    OTEL_TIMEOUT_MS: int = Field(default=2_000, ge=100, le=15_000)
    #: Head-based sampling ratio. The decision is made once per trace from
    #: the trace id (deterministic across languages); 0 records nothing
    #: except priority operations, 1 records every eligible operation.
    OTEL_SAMPLE_RATIO: float = Field(default=0.1, ge=0.0, le=1.0)
    #: Comma-separated operations exempt from ratio sampling. Bounded by
    #: the engine's TRACED_OPERATIONS allow-list; unknown names are logged
    #: and dropped, never guessed at.
    OTEL_PRIORITY_OPERATIONS: str = "execution.transmit"

    #: Arming switch for the closed fault-point universe
    #: (wlct_trading.observability.faults). Valid ONLY outside production,
    #: and only together with the non-production-only guard below.
    FAILURE_INJECTION_ENABLED: bool = False
    #: The guard: injection is forever confined to non-production. Setting
    #: it false does not unlock production; it *disables the feature
    #: outright* (fail closed in both directions).
    FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: bool = True


    @field_validator("INTERNAL_SERVICE_TOKEN")
    @classmethod
    def _reject_placeholder_token(cls, value: str) -> str:
        if value.strip().lower() in {"changeme", "change_me", "placeholder", "secret", "token"}:
            raise ValueError("INTERNAL_SERVICE_TOKEN must not be a placeholder value")
        return value

    @field_validator("BINANCE_WS_URL")
    @classmethod
    def _require_tls_websocket(cls, value: str) -> str:
        # Refused rather than warned about: market data received over a
        # plaintext socket can be modified in flight, and a book built from
        # modified data is worse than no book at all.
        if not value.startswith("wss://"):
            raise ValueError("BINANCE_WS_URL must use wss:// (TLS)")
        return value

    @field_validator("BINANCE_REST_URL")
    @classmethod
    def _require_tls_rest(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("BINANCE_REST_URL must use https://")
        return value

    @model_validator(mode="after")
    def _require_observability_in_production(self) -> "Settings":
        if self.NODE_ENV == "production" and not self.OBSERVABILITY_ENABLED:
            raise ValueError(
                "OBSERVABILITY_ENABLED=false in production: the operations "
                "panel, health mirror and alert stream are mandatory for a "
                "deployment holding real money. Disable them in development "
                "freely; not here."
            )
        return self

    @model_validator(mode="after")
    def _require_reliability_switches(self) -> Settings:
        """Part 10 production discipline, in code rather than folklore.

        * tracing enabled in production must have somewhere to send spans:
          enabled-but-homeless telemetry is silent telemetry, and the whole
          point of the export-outcome counters is that silence is loud here;
        * failure injection cannot be armed in production at all, and
          cannot be armed anywhere without the non-production-only guard
          explicitly on - there is no override in either direction.
        """
        if self.OTEL_ENABLED and self.is_production and not self.OTEL_ENDPOINT:
            raise ValueError(
                "OTEL_ENDPOINT is mandatory in production when OTEL_ENABLED=true"
            )
        if self.OTEL_ENDPOINT is not None and not self.OTEL_ENDPOINT.startswith(
            ("http://", "https://")
        ):
            raise ValueError("OTEL_ENDPOINT must be an http(s) URL (OTLP/HTTP)")
        if self.FAILURE_INJECTION_ENABLED:
            if not self.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY:
                raise ValueError(
                    "FAILURE_INJECTION_ENABLED=true requires the "
                    "FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY guard to be "
                    "true; disabling the guard disables the feature, it does "
                    "not unlock more"
                )
            if self.is_production:
                raise ValueError(
                    "FAILURE_INJECTION_ENABLED=true is a test-harness switch; "
                    "production refuses to start with it armed"
                )
        return self

    @model_validator(mode="after")
    def _require_a_channel_when_streaming(self) -> "Settings":
        if self.MARKET_DATA_STREAMING_ENABLED and not self.enabled_channels:
            raise ValueError(
                "MARKET_DATA_STREAMING_ENABLED is on but every channel is "
                "disabled; enable at least one of MARKET_DATA_TICKER_ENABLED, "
                "MARKET_DATA_TRADES_ENABLED or MARKET_DATA_ORDERBOOK_ENABLED"
            )
        if self.HTTP_TOTAL_TIMEOUT_MS < self.HTTP_READ_TIMEOUT_MS:
            raise ValueError(
                "HTTP_TOTAL_TIMEOUT_MS must be at least HTTP_READ_TIMEOUT_MS"
            )
        return self

    @property
    def sources(self) -> list[str]:
        return [item.strip().lower() for item in self.MARKET_DATA_SOURCES.split(",") if item.strip()]

    @property
    def symbols(self) -> list[str]:
        return [item.strip().upper() for item in self.MARKET_DATA_SYMBOLS.split(",") if item.strip()]

    @property
    def enabled_channels(self) -> list[str]:
        """Channel names for the live feed, in a stable order."""
        channels: list[str] = []
        if self.MARKET_DATA_ORDERBOOK_ENABLED:
            channels.append("orderbook")
        if self.MARKET_DATA_TRADES_ENABLED:
            channels.append("trades")
        if self.MARKET_DATA_TICKER_ENABLED:
            channels.append("bookticker")
        return channels

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
