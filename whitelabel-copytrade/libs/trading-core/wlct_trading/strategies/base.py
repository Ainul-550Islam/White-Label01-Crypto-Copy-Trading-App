"""The strategy base class.

This does **not** introduce a second strategy protocol. The platform already
has one - :class:`wlct_trading.signals.BaseStrategy`, added in Part 2 - and
:class:`Strategy` is a subclass of it. Every existing lifecycle method
(``initialize``, ``start``, ``stop``, ``on_market_data``,
``on_order_book_update``, ``on_trade``, ``on_candle``, ``on_timer``,
``generate_signal``) keeps its signature and its meaning. What this class adds
is the context-driven decision entry point, validated parameters, per-instance
state, and the identity a strategy needs to be reproducible.

Naming note, to avoid inventing aliases: the ticker handler is
``on_market_data`` and the book handler is ``on_order_book_update``. Those are
the names Part 2 established and the engine calls them; adding ``on_ticker``
and ``on_order_book`` as second spellings would be duplicate surface for no
capability.

The contract in one paragraph: a strategy receives normalised market data and a
read-only :class:`~wlct_trading.strategies.context.StrategyContext`, and
returns at most one :class:`~wlct_trading.signals.Signal` per decision. It
cannot see a credential, cannot see the trading mode, cannot reach an exchange
and cannot approve its own risk. Those are structural properties of what it is
given, not rules it is asked to follow.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Any, ClassVar, Mapping

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderType,
    SignalAction,
    TimeInForce,
)
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.signals import BaseStrategy, Signal, StrategyDescriptor
from wlct_trading.strategies.context import StrategyContext
from wlct_trading.strategies.features.engine import FeatureConfig, FeatureSnapshot
from wlct_trading.strategies.parameters import ParameterSchema
from wlct_trading.strategies.state import StrategyInstanceKey, StrategyState

__all__ = [
    "Strategy",
    "StrategyDefinitionError",
    "instance_key_for",
]

_ZERO = Decimal(0)
_ONE = Decimal(1)


class StrategyDefinitionError(ValueError):
    """Raised when a strategy class or instance is defined incoherently."""


def instance_key_for(
    descriptor: StrategyDescriptor,
    *,
    strategy_key: str,
    strategy_version: str,
    symbol: str,
    configuration_version: str = "1",
    market_type: MarketType = MarketType.SPOT,
) -> StrategyInstanceKey:
    """Build the instance key for one symbol of a descriptor.

    Kept as a free function so the registry, the engine and the backtest runner
    all derive identity the same way instead of each assembling a key by hand.
    """
    return StrategyInstanceKey(
        tenant_id=descriptor.tenant_id,
        strategy_key=strategy_key,
        strategy_version=strategy_version,
        exchange=descriptor.exchange,
        symbol=symbol,
        configuration_version=configuration_version,
        market_type=market_type,
    )


class Strategy(BaseStrategy):
    """Context-driven strategy. One instance trades one symbol.

    Subclasses must declare three class attributes and implement
    :meth:`evaluate`:

    ``strategy_key``
        Stable registry id, e.g. ``"DETERMINISTIC_IMBALANCE_V1"``. Never
        changes for the life of the strategy.
    ``strategy_version``
        Semantic version of *this implementation*. Any behavioural change
        requires a new version - the registry refuses to re-register the same
        key and version pointing at different code.
    ``parameter_schema``
        A :class:`~wlct_trading.strategies.parameters.ParameterSchema`. An
        empty schema means the strategy takes no parameters, and a caller who
        passes one gets an error rather than a silently ignored setting.
    """

    #: Stable registry identifier.
    strategy_key: ClassVar[str] = ""
    #: Version of this implementation.
    strategy_version: ClassVar[str] = ""
    #: Human-readable description. Must not make a profitability claim.
    description: ClassVar[str] = ""
    #: Declared parameters.
    parameter_schema: ClassVar[ParameterSchema] = ParameterSchema()

    def __init__(
        self,
        descriptor: StrategyDescriptor,
        *,
        symbol: str,
        parameters: Mapping[str, Any] | None = None,
        configuration_version: str = "1",
        market_type: MarketType = MarketType.SPOT,
        feature_config: FeatureConfig | None = None,
    ) -> None:
        cls = type(self)
        if not cls.strategy_key:
            raise StrategyDefinitionError(
                f"{cls.__name__} must declare a non-empty strategy_key."
            )
        if not cls.strategy_version:
            raise StrategyDefinitionError(
                f"{cls.__name__} must declare a non-empty strategy_version."
            )
        if symbol not in descriptor.symbols:
            raise StrategyDefinitionError(
                f"Symbol {symbol!r} is not in the descriptor's symbol list "
                f"{list(descriptor.symbols)}."
            )
        if descriptor.version and descriptor.version != cls.strategy_version:
            # A descriptor pinned to one version must not be run by a different
            # implementation version: that is precisely the silent behavioural
            # change the versioning rules exist to prevent.
            raise StrategyDefinitionError(
                f"Descriptor pins version {descriptor.version!r} but "
                f"{cls.__name__} is version {cls.strategy_version!r}."
            )

        super().__init__(descriptor)

        self._symbol = symbol
        self._parameters: dict[str, Any] = cls.parameter_schema.validate(parameters)
        self._key = instance_key_for(
            descriptor,
            strategy_key=cls.strategy_key,
            strategy_version=cls.strategy_version,
            symbol=symbol,
            configuration_version=configuration_version,
            market_type=market_type,
        )
        self._state = StrategyState(key=self._key)
        self._feature_config = feature_config or FeatureConfig()
        self._signal_sequence = 0
        self._last_context: StrategyContext | None = None

    # -- identity --------------------------------------------------------
    @property
    def key(self) -> StrategyInstanceKey:
        return self._key

    @property
    def instance_id(self) -> str:
        return self._key.instance_id

    @property
    def symbol(self) -> str:
        return self._symbol

    @property
    def exchange(self) -> ExchangeId:
        return self.descriptor.exchange

    @property
    def state(self) -> StrategyState:
        return self._state

    @property
    def parameters(self) -> dict[str, Any]:
        """Validated parameters. A copy, so a strategy cannot mutate its own
        configuration and thereby change behaviour without a version bump."""
        return dict(self._parameters)

    @property
    def feature_config(self) -> FeatureConfig:
        return self._feature_config

    @property
    def signal_count(self) -> int:
        return self._signal_sequence

    @classmethod
    def implementation_id(cls) -> str:
        """Fully qualified path of the implementing class.

        Recorded on every backtest result so a run can be traced back to the
        exact class, not merely to a version string somebody could have reused.
        """
        return f"{cls.__module__}.{cls.__qualname__}"

    @classmethod
    def describe_definition(cls) -> dict[str, object]:
        return {
            "strategyKey": cls.strategy_key,
            "strategyVersion": cls.strategy_version,
            "implementationId": cls.implementation_id(),
            "description": cls.description,
            "parameters": cls.parameter_schema.to_dict()["parameters"],
        }

    # -- lifecycle -------------------------------------------------------
    def initialize(self) -> None:
        """Prepare deterministic initial state, then run the subclass hook."""
        self._state.reset()
        self._signal_sequence = 0
        self._last_context = None
        super().initialize()
        self.on_initialize()

    def start(self) -> None:
        super().start()
        self.on_start()

    def stop(self) -> None:
        was_running = self.is_running
        super().stop()
        if was_running:
            self.on_stop()

    def reset(self) -> None:
        """Full reset: state, counters and cached context.

        Called when the host must discard accumulated state - after an
        order-book invalidation, or between backtest folds - so that the next
        decision is made from a known-clean starting point.
        """
        self._state.reset()
        self._signal_sequence = 0
        self._last_context = None
        self.on_reset()

    # -- subclass hooks --------------------------------------------------
    def on_initialize(self) -> None:
        """Called once from :meth:`initialize`."""

    def on_start(self) -> None:
        """Called after the instance transitions to running."""

    def on_stop(self) -> None:
        """Called when a running instance is stopped."""

    def on_reset(self) -> None:
        """Called after state has been cleared."""

    # -- market-data handlers (Part 2 signatures, unchanged) -------------
    def on_market_data(self, ticker: Ticker) -> None:
        """Ticker update. Override if the strategy needs it."""

    def on_order_book_update(self, top: BookTop) -> None:
        """Top-of-book update. Override if the strategy needs it."""

    def on_trade(self, trade: PublicTrade) -> None:
        """Public trade print. Override if the strategy needs it."""

    def on_candle(self, candle: Candle) -> None:
        """Candle update. Override if the strategy needs it."""

    def on_timer(self, now_micros: int) -> None:
        """Timer tick. ``now_micros`` is the engine clock, simulated in
        backtests."""

    # -- decision --------------------------------------------------------
    def evaluate(self, context: StrategyContext) -> Signal | None:
        """Produce at most one signal for this context.

        Returning ``None`` means "no opinion". Returning a ``HOLD`` signal is
        an explicit, recorded decision to stay flat - the two are different and
        both are useful, so neither is collapsed into the other.
        """
        raise NotImplementedError(
            f"{type(self).__name__} must implement evaluate(context)."
        )

    def generate_signal(self, symbol: str) -> Signal | None:
        """Part 2 entry point, satisfied from the most recent context.

        Kept so that anything written against ``BaseStrategy`` keeps working.
        It cannot manufacture a context, so it returns ``None`` before the
        first event rather than deciding on empty data.
        """
        context = self._last_context
        if context is None or symbol != self._symbol:
            return None
        return self.evaluate(context)

    def remember_context(self, context: StrategyContext) -> None:
        """Record the context the engine is about to evaluate with."""
        self._last_context = context

    @property
    def last_context(self) -> StrategyContext | None:
        return self._last_context

    # -- signal construction ---------------------------------------------
    def build_signal(
        self,
        context: StrategyContext,
        *,
        action: SignalAction,
        confidence: Decimal = _ONE,
        target_quantity: Decimal | None = None,
        order_type: OrderType = OrderType.LIMIT,
        limit_price: Decimal | None = None,
        stop_price: Decimal | None = None,
        time_in_force: TimeInForce = TimeInForce.GTC,
        reason: str | None = None,
        reference_price: Decimal | None = None,
        valid_for_micros: int | None = None,
        feature_keys: tuple[str, ...] = (),
        metadata: Mapping[str, str] | None = None,
    ) -> Signal:
        """Construct a signal with deterministic identity and full provenance.

        Determinism matters: the id is derived from the instance key, the
        decision content and a per-instance emission counter, so replaying the
        same events produces the same ids. Nothing here reads a clock -
        ``created_at`` is the context's event timestamp, which under replay is
        the historical instant.

        The feature snapshot attached to the signal is limited to
        ``feature_keys`` when supplied, so a signal records the values that
        actually drove it rather than everything the engine happened to hold.
        """
        self._signal_sequence += 1
        created_at = context.event_timestamp_micros
        expires_at = (
            created_at + valid_for_micros
            if valid_for_micros is not None and valid_for_micros > 0
            else None
        )

        signal_id = self._deterministic_signal_id(
            action=action,
            created_at=created_at,
            target_quantity=target_quantity,
            limit_price=limit_price,
        )

        features: dict[str, str] = context.features.to_string_map(
            only=feature_keys or None
        )
        if metadata:
            for name, value in metadata.items():
                if not isinstance(value, str):
                    raise StrategyDefinitionError(
                        f"Signal metadata {name!r} must be a string."
                    )
                features[name] = value

        return Signal(
            signal_id=signal_id,
            tenant_id=context.tenant_id,
            strategy_id=context.instance_id,
            exchange=context.exchange,
            symbol=context.symbol,
            action=action,
            confidence=confidence,
            reference_price=(
                reference_price if reference_price is not None else context.mid_price
            ),
            target_quantity=target_quantity,
            order_type=order_type,
            limit_price=limit_price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            reason=reason,
            created_at=created_at,
            metadata={
                "strategyKey": context.strategy_key,
                "instanceId": context.instance_id,
                "sequence": str(self._signal_sequence),
            },
            strategy_version=context.strategy_version,
            expires_at=expires_at,
            features=features,
        )

    def _deterministic_signal_id(
        self,
        *,
        action: SignalAction,
        created_at: int,
        target_quantity: Decimal | None,
        limit_price: Decimal | None,
    ) -> str:
        source = "|".join(
            (
                self._key.fingerprint_source(),
                action.value,
                str(created_at),
                str(target_quantity) if target_quantity is not None else "-",
                str(limit_price) if limit_price is not None else "-",
                str(self._signal_sequence),
            )
        )
        return "sig-" + hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]

    # -- helpers -----------------------------------------------------------
    @staticmethod
    def feature_or_none(snapshot: FeatureSnapshot, name: str) -> Decimal | None:
        return snapshot.value(name)
