"""Static capability registry for supported exchanges.

The registry describes what each venue *can* do; it does not connect to
anything. Real connectivity (via ccxt) arrives with order routing in a later
part. Keeping the capability matrix declarative means the API and the admin UI
can render accurate options long before execution is switched on.
"""

from __future__ import annotations

from app.config import Settings
from app.schemas import ExchangeCapability, ExchangeId

_CAPABILITIES: dict[ExchangeId, dict[str, object]] = {
    ExchangeId.BINANCE: {
        "supports_spot": True,
        "supports_futures": True,
        "supports_sandbox": True,
        "requires_passphrase": False,
        "rate_limit_per_minute": 1200,
    },
    ExchangeId.BYBIT: {
        "supports_spot": True,
        "supports_futures": True,
        "supports_sandbox": True,
        "requires_passphrase": False,
        "rate_limit_per_minute": 600,
    },
    ExchangeId.OKX: {
        "supports_spot": True,
        "supports_futures": True,
        "supports_sandbox": True,
        # OKX issues a passphrase alongside the key/secret pair.
        "requires_passphrase": True,
        "rate_limit_per_minute": 600,
    },
    ExchangeId.KRAKEN: {
        "supports_spot": True,
        "supports_futures": True,
        "supports_sandbox": False,
        "requires_passphrase": False,
        "rate_limit_per_minute": 60,
    },
    ExchangeId.COINBASE: {
        "supports_spot": True,
        "supports_futures": False,
        "supports_sandbox": True,
        "requires_passphrase": True,
        "rate_limit_per_minute": 600,
    },
}


class ExchangeRegistry:
    """Answers "what can we do with this venue" questions."""

    def __init__(self, settings: Settings) -> None:
        self._enabled = set(settings.enabled_exchanges)
        self._sandbox_only = settings.EXCHANGE_SANDBOX_MODE

    def list_capabilities(self) -> list[ExchangeCapability]:
        capabilities: list[ExchangeCapability] = []

        for exchange, traits in _CAPABILITIES.items():
            enabled = exchange.value in self._enabled
            # A sandbox-only deployment must not advertise venues that have no
            # test environment: enabling one would push real orders live.
            if enabled and self._sandbox_only and not traits["supports_sandbox"]:
                enabled = False

            capabilities.append(
                ExchangeCapability(
                    exchange=exchange,
                    enabled=enabled,
                    supportsSpot=bool(traits["supports_spot"]),
                    supportsFutures=bool(traits["supports_futures"]),
                    supportsSandbox=bool(traits["supports_sandbox"]),
                    requiresPassphrase=bool(traits["requires_passphrase"]),
                    rateLimitPerMinute=int(traits["rate_limit_per_minute"]),  # type: ignore[arg-type]
                )
            )

        return capabilities

    def is_enabled(self, exchange: ExchangeId) -> bool:
        return any(
            capability.exchange == exchange and capability.enabled
            for capability in self.list_capabilities()
        )
