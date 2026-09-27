"""Adapter registry — the pluggability seam.

Adding a venue means writing an adapter and registering it here. Nothing else in
the platform changes: the market-data service, OMS, execution engine and risk
engine all resolve venues through this registry and only ever see the abstract
contracts from :mod:`wlct_trading.adapters.base`.

Registration is by factory rather than by instance. Adapters are per-tenant and
per-account (they hold a credential resolver bound to one trading account), so a
shared singleton would be a cross-tenant leak. The registry stores the recipe;
callers build the instance they are entitled to.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from wlct_trading.adapters.base import ExchangeAdapter, MarketDataAdapter
from wlct_trading.enums import ExchangeId
from wlct_trading.exchanges.capabilities import ExchangeCapabilities

__all__ = [
    "MarketDataAdapterFactory",
    "TradingAdapterFactory",
    "ExchangeRegistration",
    "ExchangeRegistry",
    "UnsupportedExchange",
    "DuplicateRegistration",
]

#: Builds a credential-free market-data adapter.
MarketDataAdapterFactory = Callable[..., MarketDataAdapter]
#: Builds a full adapter bound to one account's credential resolver.
TradingAdapterFactory = Callable[..., ExchangeAdapter]


class UnsupportedExchange(Exception):
    """Raised when a venue has no registered adapter."""


class DuplicateRegistration(Exception):
    """Raised when a venue is registered twice.

    Fails loudly on purpose. A silent overwrite would mean orders quietly
    routing through a different adapter than the operator believes.
    """


@dataclass(slots=True, frozen=True)
class ExchangeRegistration:
    """Everything the platform knows about one pluggable venue."""

    exchange: ExchangeId
    capabilities: ExchangeCapabilities
    market_data_factory: MarketDataAdapterFactory
    trading_factory: TradingAdapterFactory | None = None
    #: ``False`` keeps a half-finished venue out of the routable set while its
    #: code still lives in the tree.
    enabled: bool = True

    @property
    def supports_trading(self) -> bool:
        return self.trading_factory is not None


class ExchangeRegistry:
    """Maps :class:`ExchangeId` to adapter factories and capabilities."""

    __slots__ = ("_registrations",)

    def __init__(self) -> None:
        self._registrations: dict[ExchangeId, ExchangeRegistration] = {}

    def register(
        self, registration: ExchangeRegistration, *, replace: bool = False
    ) -> None:
        if registration.exchange in self._registrations and not replace:
            raise DuplicateRegistration(
                f"{registration.exchange.value} is already registered. Pass "
                f"replace=True only if the override is deliberate."
            )
        self._registrations[registration.exchange] = registration

    def unregister(self, exchange: ExchangeId) -> bool:
        return self._registrations.pop(exchange, None) is not None

    def get(self, exchange: ExchangeId) -> ExchangeRegistration:
        registration = self._registrations.get(exchange)
        if registration is None:
            raise UnsupportedExchange(
                f"No adapter is registered for {exchange.value}. Registered: "
                f"{', '.join(sorted(e.value for e in self._registrations)) or 'none'}."
            )
        if not registration.enabled:
            raise UnsupportedExchange(
                f"The {exchange.value} adapter is registered but disabled."
            )
        return registration

    def capabilities(self, exchange: ExchangeId) -> ExchangeCapabilities:
        return self.get(exchange).capabilities

    def create_market_data_adapter(
        self, exchange: ExchangeId, **kwargs: object
    ) -> MarketDataAdapter:
        """Build a market-data adapter. Takes no credentials by construction."""
        return self.get(exchange).market_data_factory(**kwargs)

    def create_trading_adapter(
        self, exchange: ExchangeId, **kwargs: object
    ) -> ExchangeAdapter:
        """Build a trading adapter for one account.

        ``kwargs`` must include that account's credential resolver; the registry
        never holds credentials itself.
        """
        registration = self.get(exchange)
        if registration.trading_factory is None:
            raise UnsupportedExchange(
                f"The {exchange.value} adapter supports market data only; "
                f"order placement is not implemented for this venue."
            )
        return registration.trading_factory(**kwargs)

    def supported_exchanges(self) -> tuple[ExchangeId, ...]:
        return tuple(
            sorted(
                (e for e, r in self._registrations.items() if r.enabled),
                key=lambda e: e.value,
            )
        )

    def tradeable_exchanges(self) -> tuple[ExchangeId, ...]:
        return tuple(
            sorted(
                (
                    e
                    for e, r in self._registrations.items()
                    if r.enabled and r.supports_trading
                ),
                key=lambda e: e.value,
            )
        )

    def is_supported(self, exchange: ExchangeId) -> bool:
        registration = self._registrations.get(exchange)
        return registration is not None and registration.enabled

    def describe(self) -> tuple[dict[str, object], ...]:
        """Capability catalogue for the admin console."""
        return tuple(
            {
                **registration.capabilities.to_public_dict(),
                "enabled": registration.enabled,
                "supportsTrading": registration.supports_trading,
            }
            for _, registration in sorted(
                self._registrations.items(), key=lambda item: item[0].value
            )
        )

    @property
    def count(self) -> int:
        return len(self._registrations)

    def clear(self) -> None:
        self._registrations.clear()
