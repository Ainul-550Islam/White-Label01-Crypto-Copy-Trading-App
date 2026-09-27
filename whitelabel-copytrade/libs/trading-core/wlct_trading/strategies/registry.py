"""Strategy registry and factory.

Strategies are addressed by a stable ``(strategy_key, strategy_version)`` pair.
The registry maps that pair to exactly one implementation class and refuses to
let it mean anything else afterwards - registering the same key and version
against a different class raises :class:`StrategyVersionConflict`.

That refusal is the whole point. A backtest result records a key and a version;
if the code behind that pair could change, the record would be a claim about
something unreproducible. Behaviour changes require a new version, always.

The registry holds *classes*, not instances. Instantiation goes through
:meth:`StrategyRegistry.create`, which validates parameters against the
declared schema before the object exists, so a misconfigured strategy fails at
construction rather than on its first market event.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator, Mapping

from wlct_trading.enums import MarketType
from wlct_trading.signals import StrategyDescriptor
from wlct_trading.strategies.base import Strategy, StrategyDefinitionError
from wlct_trading.strategies.features.engine import FeatureConfig
from wlct_trading.strategies.parameters import ParameterSchema

__all__ = [
    "RESERVED_STRATEGY_KEYS",
    "StrategyRegistration",
    "StrategyRegistry",
    "StrategyNotRegistered",
    "StrategyVersionConflict",
    "build_default_strategy_registry",
]

#: Names reserved for future strategy families so that nothing else claims
#: them. **None of these is implemented**, and listing a name here is not a
#: statement that such a strategy works, is safe, or would be profitable. The
#: only implementation shipped in this part is the deterministic example, which
#: exists to exercise the architecture.
RESERVED_STRATEGY_KEYS: tuple[str, ...] = (
    "MARKET_MAKING_V1",
    "MOMENTUM_V1",
    "MEAN_REVERSION_V1",
    "MICROSTRUCTURE_V1",
)


class StrategyNotRegistered(KeyError):
    """Raised when an unknown strategy key or version is requested."""


class StrategyVersionConflict(ValueError):
    """Raised when a key and version would be rebound to different code."""


@dataclass(slots=True, frozen=True)
class StrategyRegistration:
    """One registered strategy implementation."""

    strategy_key: str
    strategy_version: str
    implementation_id: str
    strategy_class: type[Strategy]
    parameter_schema: ParameterSchema
    description: str

    @property
    def registry_id(self) -> str:
        return f"{self.strategy_key}@{self.strategy_version}"

    def to_dict(self) -> dict[str, object]:
        return {
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "implementationId": self.implementation_id,
            "description": self.description,
            "parameters": self.parameter_schema.to_dict()["parameters"],
        }


class StrategyRegistry:
    """Maps stable ids to strategy classes and builds instances from them."""

    __slots__ = ("_registrations",)

    def __init__(self) -> None:
        self._registrations: dict[tuple[str, str], StrategyRegistration] = {}

    # -- registration ----------------------------------------------------
    def register(self, strategy_class: type[Strategy]) -> StrategyRegistration:
        """Register a strategy class by its declared key and version.

        Re-registering the identical class is a no-op, which keeps module
        reloads and repeated imports harmless. Re-registering a *different*
        class under the same key and version raises.
        """
        if not isinstance(strategy_class, type) or not issubclass(
            strategy_class, Strategy
        ):
            raise StrategyDefinitionError(
                f"{strategy_class!r} is not a Strategy subclass."
            )
        key = strategy_class.strategy_key
        version = strategy_class.strategy_version
        if not key:
            raise StrategyDefinitionError(
                f"{strategy_class.__name__} declares no strategy_key."
            )
        if not version:
            raise StrategyDefinitionError(
                f"{strategy_class.__name__} declares no strategy_version."
            )

        implementation_id = strategy_class.implementation_id()
        existing = self._registrations.get((key, version))
        if existing is not None:
            if existing.implementation_id == implementation_id:
                return existing
            raise StrategyVersionConflict(
                f"{key}@{version} is already registered to "
                f"{existing.implementation_id}; refusing to rebind it to "
                f"{implementation_id}. Behaviour changes require a new version."
            )

        registration = StrategyRegistration(
            strategy_key=key,
            strategy_version=version,
            implementation_id=implementation_id,
            strategy_class=strategy_class,
            parameter_schema=strategy_class.parameter_schema,
            description=strategy_class.description,
        )
        self._registrations[(key, version)] = registration
        return registration

    def unregister(self, strategy_key: str, strategy_version: str) -> None:
        self._registrations.pop((strategy_key, strategy_version), None)

    # -- lookup -----------------------------------------------------------
    def get(self, strategy_key: str, strategy_version: str) -> StrategyRegistration:
        registration = self._registrations.get((strategy_key, strategy_version))
        if registration is None:
            raise StrategyNotRegistered(
                f"No strategy registered as {strategy_key}@{strategy_version}. "
                f"Known: {', '.join(self.registry_ids()) or '(none)'}."
            )
        return registration

    def has(self, strategy_key: str, strategy_version: str) -> bool:
        return (strategy_key, strategy_version) in self._registrations

    def versions_of(self, strategy_key: str) -> tuple[str, ...]:
        return tuple(
            sorted(
                version
                for (key, version) in self._registrations
                if key == strategy_key
            )
        )

    def keys(self) -> tuple[str, ...]:
        return tuple(sorted({key for (key, _version) in self._registrations}))

    def registry_ids(self) -> tuple[str, ...]:
        return tuple(sorted(reg.registry_id for reg in self._registrations.values()))

    def all(self) -> tuple[StrategyRegistration, ...]:
        return tuple(
            sorted(self._registrations.values(), key=lambda reg: reg.registry_id)
        )

    def __len__(self) -> int:
        return len(self._registrations)

    def __iter__(self) -> Iterator[StrategyRegistration]:
        return iter(self.all())

    def describe(self) -> list[dict[str, object]]:
        return [registration.to_dict() for registration in self.all()]

    # -- construction ------------------------------------------------------
    def create(
        self,
        strategy_key: str,
        strategy_version: str,
        *,
        descriptor: StrategyDescriptor,
        symbol: str,
        parameters: Mapping[str, Any] | None = None,
        configuration_version: str = "1",
        market_type: MarketType = MarketType.SPOT,
        feature_config: FeatureConfig | None = None,
    ) -> Strategy:
        """Instantiate a registered strategy for one symbol.

        Parameters are validated by the strategy's own schema inside the
        constructor, so an unknown key or an out-of-range value raises here and
        no partially configured instance is ever produced.
        """
        registration = self.get(strategy_key, strategy_version)
        return registration.strategy_class(
            descriptor,
            symbol=symbol,
            parameters=parameters,
            configuration_version=configuration_version,
            market_type=market_type,
            feature_config=feature_config,
        )

    def create_for_descriptor(
        self,
        strategy_key: str,
        strategy_version: str,
        *,
        descriptor: StrategyDescriptor,
        parameters: Mapping[str, Any] | None = None,
        configuration_version: str = "1",
        market_type: MarketType = MarketType.SPOT,
        feature_config: FeatureConfig | None = None,
    ) -> tuple[Strategy, ...]:
        """One instance per symbol in the descriptor.

        Symbol-specific instances rather than one instance handling every
        symbol: state stays isolated per symbol, and a failure in one symbol's
        instance cannot corrupt another's.
        """
        return tuple(
            self.create(
                strategy_key,
                strategy_version,
                descriptor=descriptor,
                symbol=symbol,
                parameters=parameters,
                configuration_version=configuration_version,
                market_type=market_type,
                feature_config=feature_config,
            )
            for symbol in descriptor.symbols
        )


def build_default_strategy_registry() -> StrategyRegistry:
    """Registry containing every strategy shipped with the library.

    That is currently one strategy: the deterministic example. It exists to
    exercise and test the architecture end to end. No claim is made that it is
    profitable, and it should not be run with real money.
    """
    from wlct_trading.strategies.implementations.deterministic_example import (
        DeterministicImbalanceStrategy,
    )

    registry = StrategyRegistry()
    registry.register(DeterministicImbalanceStrategy)
    return registry
