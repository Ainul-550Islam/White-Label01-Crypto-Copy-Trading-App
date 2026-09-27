"""Configuration for the trading engine.

Every value comes from the environment and is validated at import time. There
are no defaults for secrets: a missing credential stops the process rather than
starting a service that silently cannot authenticate.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Query parameters that Prisma accepts in DATABASE_URL but libpq/asyncpg do
#: not. The whole platform shares a single DATABASE_URL, and Prisma's connection
#: string almost always ends in `?schema=public`. asyncpg forwards unknown query
#: parameters to the server as runtime settings, so leaving them in place makes
#: every connection fail with `UndefinedObjectError: unrecognized configuration
#: parameter "schema"`. They are stripped instead of being rejected, so the same
#: URL keeps working for Prisma, PgBouncer and this service.
PRISMA_ONLY_DSN_PARAMS: frozenset[str] = frozenset(
    {
        "schema",
        "connection_limit",
        "pool_timeout",
        "pgbouncer",
        "socket_timeout",
        "sslaccept",
        "sslidentity",
        "sslpassword",
        "statement_cache_size",
    }
)


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

    TRADING_ENGINE_HOST: str = "0.0.0.0"
    TRADING_ENGINE_PORT: int = Field(default=8001, ge=1, le=65535)
    TRADING_ENGINE_HEALTH_PATH: str = "/health"

    DATABASE_URL: str
    REDIS_HOST: str
    REDIS_PORT: int = Field(default=6379, ge=1, le=65535)
    REDIS_PASSWORD: str | None = None
    REDIS_DB: int = Field(default=0, ge=0, le=15)
    REDIS_TLS: bool = False

    QUEUE_PREFIX: str = "wlct"

    #: Shared secret proving a request came from the API, not the public internet.
    INTERNAL_SERVICE_TOKEN: str = Field(min_length=32)

    #: Master kill switch. Order placement is impossible while this is false.
    EXECUTION_ENABLED: bool = False
    EXCHANGE_SANDBOX_MODE: bool = True
    EXCHANGES_ENABLED: str = "binance,bybit,okx"

    #: Risk guard rails applied before any order is ever constructed.
    MAX_ORDER_NOTIONAL_USD: float = Field(default=1000.0, gt=0)
    MAX_OPEN_POSITIONS_PER_ACCOUNT: int = Field(default=20, ge=1)
    MAX_LEVERAGE: int = Field(default=5, ge=1, le=125)

    # ------------------------------------------------------------------
    # Part 9: observability (metrics exposition, health mirror, alerting)
    #
    # These are *publication* switches, never trading switches: turning
    # observability off removes the panel the operator relies on and grants
    # nothing. Production refuses to parse with them off.
    # ------------------------------------------------------------------
    #: How old a published hot risk snapshot may be before the trading
    #: readiness gate refuses to call state fresh. Mirrors the platform key
    #: of the same name; must stay inside the same band as the API's
    #: MAX_RISK_STATE_AGE_MS so panel and gate never disagree by units.
    MAX_RISK_STATE_AGE_MS: int = Field(default=2_000, ge=100, le=60_000)

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
        placeholders = {"changeme", "change_me", "placeholder", "secret", "token"}
        if value.strip().lower() in placeholders:
            raise ValueError("INTERNAL_SERVICE_TOKEN must not be a placeholder value")
        return value

    @model_validator(mode="after")
    def _require_observability_in_production(self) -> Settings:
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

    @property
    def asyncpg_dsn(self) -> str:
        """DATABASE_URL rewritten for asyncpg.

        Only the Prisma-specific query parameters listed in
        PRISMA_ONLY_DSN_PARAMS are removed; genuine libpq parameters such as
        `sslmode` or `application_name` are preserved so TLS configuration keeps
        working. The credentials in the URL are never logged.
        """
        parts = urlsplit(self.DATABASE_URL)
        retained = [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in PRISMA_ONLY_DSN_PARAMS
        ]
        return urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(retained), parts.fragment)
        )

    @property
    def enabled_exchanges(self) -> list[str]:
        return [item.strip().lower() for item in self.EXCHANGES_ENABLED.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so configuration is parsed exactly once per process."""
    return Settings()  # type: ignore[call-arg]
