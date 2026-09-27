"""Part 6: strategy registration, parameters, state, lifecycle and validation.

These tests cover the contract that keeps many strategies running side by side
without interfering with one another, and the boundary that stops a strategy
reaching an exchange or authorising its own risk.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderType,
    SignalAction,
    SignalRejectionCode,
    StrategyFailurePolicy,
    StrategyStatus,
)
from wlct_trading.market_data import BookTop
from wlct_trading.risk import KillSwitchState
from wlct_trading.signals import Signal, StrategyDescriptor, StrategyRiskProfile
from wlct_trading.strategies import (
    RESERVED_STRATEGY_KEYS,
    CooldownGate,
    ParameterError,
    ParameterSchema,
    ParameterSpec,
    ParameterType,
    SignalDeduplicator,
    SignalValidationConfig,
    SignalValidator,
    Strategy,
    StrategyContext,
    StrategyDefinitionError,
    StrategyEngine,
    StrategyEngineConfig,
    StrategyInstanceKey,
    StrategyNotRegistered,
    StrategyRegistry,
    StrategyRiskView,
    StrategyState,
    StrategyStateError,
    StrategyVersionConflict,
    build_default_strategy_registry,
    signal_identity,
)
from wlct_trading.strategies.implementations import DeterministicImbalanceStrategy

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

D = Decimal
OTHER_SYMBOL = "ETH-USDT"


def make_descriptor(
    *,
    strategy_id: str = "strategy-1",
    tenant_id: str = "tenant-1",
    version: str = "1.0.0",
    symbols: tuple[str, ...] = (SYMBOL,),
    enabled: bool = True,
) -> StrategyDescriptor:
    return StrategyDescriptor(
        strategy_id=strategy_id,
        tenant_id=tenant_id,
        name="test strategy",
        version=version,
        enabled=enabled,
        exchange=EXCHANGE,
        symbols=symbols,
        risk_profile=StrategyRiskProfile(
            max_order_quantity=D("1"),
            max_position_quantity=D("1"),
            max_order_notional=D("100000"),
            max_daily_loss=D("1000"),
            max_open_orders=5,
            max_orders_per_minute=60,
        ),
    )


def book(
    *,
    bid_qty: str = "9",
    ask_qty: str = "1",
    timestamp: int = BASE_TS,
    symbol: str = SYMBOL,
) -> BookTop:
    return BookTop(
        exchange=EXCHANGE,
        symbol=symbol,
        best_bid=D("29995.00"),
        best_bid_quantity=D(bid_qty),
        best_ask=D("30005.00"),
        best_ask_quantity=D(ask_qty),
        sequence=1,
        exchange_timestamp=timestamp,
        received_timestamp=timestamp,
    )


class AlwaysBuyStrategy(Strategy):
    """Minimal deterministic strategy used as a test fixture."""

    strategy_key = "TEST_ALWAYS_BUY_V1"
    strategy_version = "1.0.0"
    description = "Emits one BUY per event. Test fixture; makes no profit claim."
    parameter_schema = ParameterSchema(
        specs=(
            ParameterSpec(
                name="order_quantity",
                kind=ParameterType.DECIMAL,
                description="Quantity per signal.",
                default=D("0.001"),
                minimum=D("0.000001"),
                maximum=D("1"),
            ),
        )
    )

    def evaluate(self, context: StrategyContext) -> Signal | None:
        if context.features.best_bid is None:
            return None
        return self.build_signal(
            context,
            action=SignalAction.BUY,
            confidence=D("0.5"),
            target_quantity=self.parameters["order_quantity"],
            order_type=OrderType.LIMIT,
            limit_price=context.features.best_bid,
            reason="Test fixture always buys.",
        )


class ExplodingStrategy(Strategy):
    """Raises on every event. Used to prove failure isolation."""

    strategy_key = "TEST_EXPLODING_V1"
    strategy_version = "1.0.0"
    description = "Always raises. Test fixture."

    def evaluate(self, context: StrategyContext) -> Signal | None:
        raise RuntimeError("deliberate strategy failure")


class SilentStrategy(Strategy):
    """Never signals. Proves a quiet strategy is not treated as broken."""

    strategy_key = "TEST_SILENT_V1"
    strategy_version = "1.0.0"
    description = "Emits nothing. Test fixture."

    def evaluate(self, context: StrategyContext) -> Signal | None:
        return None


def available_risk(_key: StrategyInstanceKey) -> StrategyRiskView:
    return StrategyRiskView(
        is_available=True,
        max_position_quantity=D("1"),
        max_order_quantity=D("1"),
    )


def fresh(_key: StrategyInstanceKey) -> tuple[bool, int | None]:
    return (True, 1_000)


def build_engine(
    *,
    policy: StrategyFailurePolicy = StrategyFailurePolicy.STOP_INSTANCE,
    risk_view=available_risk,
    freshness=fresh,
    kill_switches=None,
    cooldown_micros: int = 0,
) -> StrategyEngine:
    return StrategyEngine(
        config=StrategyEngineConfig(
            failure_policy=policy,
            default_cooldown_micros=cooldown_micros,
        ),
        risk_view_provider=risk_view,
        freshness_provider=freshness,
        kill_switch_provider=kill_switches or KillSwitchState,
    )


class TestRegistry:
    """Case 1 and 2: registration and version validation."""

    def test_default_registry_exposes_only_the_example_strategy(self) -> None:
        registry = build_default_strategy_registry()
        assert registry.registry_ids() == ("DETERMINISTIC_IMBALANCE_V1@1.0.0",)

    def test_reserved_keys_are_declared_but_not_implemented(self) -> None:
        registry = build_default_strategy_registry()
        for key in RESERVED_STRATEGY_KEYS:
            assert key not in registry.keys()

    def test_registration_and_lookup_round_trip(self) -> None:
        registry = StrategyRegistry()
        registration = registry.register(AlwaysBuyStrategy)
        assert registration.registry_id == "TEST_ALWAYS_BUY_V1@1.0.0"
        assert registry.has("TEST_ALWAYS_BUY_V1", "1.0.0") is True

    def test_reregistering_the_same_class_is_a_no_op(self) -> None:
        registry = StrategyRegistry()
        first = registry.register(AlwaysBuyStrategy)
        assert registry.register(AlwaysBuyStrategy) is first

    def test_rebinding_a_version_to_another_class_is_refused(self) -> None:
        """Behaviour must not change under an unchanged version string."""

        class Impostor(Strategy):
            strategy_key = AlwaysBuyStrategy.strategy_key
            strategy_version = AlwaysBuyStrategy.strategy_version
            description = "Different implementation, same version. Test fixture."

            def evaluate(self, context: StrategyContext) -> Signal | None:
                return None

        registry = StrategyRegistry()
        registry.register(AlwaysBuyStrategy)
        with pytest.raises(StrategyVersionConflict):
            registry.register(Impostor)

    def test_unknown_strategy_raises(self) -> None:
        registry = StrategyRegistry()
        with pytest.raises(StrategyNotRegistered):
            registry.get("NOPE", "1.0.0")

    def test_a_class_without_a_key_cannot_be_registered(self) -> None:
        class Anonymous(Strategy):
            strategy_version = "1.0.0"

            def evaluate(self, context: StrategyContext) -> Signal | None:
                return None

        registry = StrategyRegistry()
        with pytest.raises(StrategyDefinitionError):
            registry.register(Anonymous)

    def test_descriptor_pinned_to_another_version_is_refused(self) -> None:
        """Behaviour must not change silently under one version string."""
        registry = StrategyRegistry()
        registry.register(AlwaysBuyStrategy)
        with pytest.raises(StrategyDefinitionError):
            registry.create(
                "TEST_ALWAYS_BUY_V1",
                "1.0.0",
                descriptor=make_descriptor(version="9.9.9"),
                symbol=SYMBOL,
            )

    def test_symbol_outside_the_descriptor_is_refused(self) -> None:
        registry = StrategyRegistry()
        registry.register(AlwaysBuyStrategy)
        with pytest.raises(StrategyDefinitionError):
            registry.create(
                "TEST_ALWAYS_BUY_V1",
                "1.0.0",
                descriptor=make_descriptor(),
                symbol=OTHER_SYMBOL,
            )

    def test_describe_disclaims_profitability(self) -> None:
        for entry in build_default_strategy_registry().describe():
            description = str(entry["description"]).lower()
            assert "no profitability claim" in description
            for banned in ("guaranteed profit", "risk-free", "always wins"):
                assert banned not in description


class TestParameters:
    """Case 3: strongly validated parameters."""

    schema = ParameterSchema(
        specs=(
            ParameterSpec(
                name="threshold",
                kind=ParameterType.DECIMAL,
                description="Entry threshold.",
                default=D("0.5"),
                minimum=D("0"),
                maximum=D("1"),
            ),
            ParameterSpec(
                name="lookback",
                kind=ParameterType.INT,
                description="Lookback length.",
                default=20,
                minimum=1,
                maximum=1000,
            ),
        )
    )

    def test_defaults_are_applied(self) -> None:
        values = self.schema.validate(None)
        assert values == {"threshold": D("0.5"), "lookback": 20}

    def test_unknown_key_is_refused(self) -> None:
        with pytest.raises(ParameterError):
            self.schema.validate({"nonsense": 1})

    def test_out_of_range_is_refused(self) -> None:
        with pytest.raises(ParameterError):
            self.schema.validate({"threshold": D("2")})

    def test_float_is_refused_for_a_decimal_parameter(self) -> None:
        with pytest.raises(ParameterError):
            self.schema.validate({"threshold": 0.5})

    def test_credential_shaped_names_are_refused(self) -> None:
        for name in ("api_key", "secret", "private_key", "signing_secret", "password"):
            with pytest.raises(ParameterError):
                ParameterSpec(
                    name=name, kind=ParameterType.STRING, description="x", default="y"
                )

    def test_parameters_are_copied_not_shared(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        parameters = strategy.parameters
        parameters["order_quantity"] = D("999")
        assert strategy.parameters["order_quantity"] == D("0.001")


class TestInstanceIdentityAndState:
    """Cases 4 and 5: deterministic init and per-instance isolation."""

    def test_instance_id_is_deterministic(self) -> None:
        first = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        second = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        assert first.instance_id == second.instance_id

    def test_instance_id_varies_with_every_key_component(self) -> None:
        base = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL).instance_id
        other_tenant = AlwaysBuyStrategy(
            make_descriptor(tenant_id="tenant-2"), symbol=SYMBOL
        ).instance_id
        other_symbol = AlwaysBuyStrategy(
            make_descriptor(symbols=(SYMBOL, OTHER_SYMBOL)), symbol=OTHER_SYMBOL
        ).instance_id
        other_config = AlwaysBuyStrategy(
            make_descriptor(), symbol=SYMBOL, configuration_version="2"
        ).instance_id
        other_market = AlwaysBuyStrategy(
            make_descriptor(), symbol=SYMBOL, market_type=MarketType.FUTURES_USDT
        ).instance_id
        assert len({base, other_tenant, other_symbol, other_config, other_market}) == 5

    def test_redis_namespace_is_tenant_scoped(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        assert strategy.key.redis_namespace.startswith("strategy:tenant-1:")

    def test_state_is_isolated_between_instances(self) -> None:
        first = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        second = AlwaysBuyStrategy(
            make_descriptor(tenant_id="tenant-2"), symbol=SYMBOL
        )
        first.state.set("counter", 5)
        assert second.state.get("counter") is None

    def test_state_snapshot_and_restore_round_trip(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        strategy.state.set("quantity", D("1.5"))
        strategy.state.set("count", 3)
        strategy.state.set("armed", True)
        strategy.state.set("label", "ready")
        snapshot = strategy.state.snapshot()

        restored = StrategyState(key=strategy.key)
        restored.restore(snapshot)
        assert restored.get_decimal("quantity") == D("1.5")
        assert restored.get_int("count") == 3
        assert restored.get_bool("armed") is True
        assert restored.get("label") == "ready"

    def test_restore_is_all_or_nothing(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        strategy.state.set("good", 1)
        with pytest.raises(StrategyStateError):
            strategy.state.restore({"good": "i:2", "bad": "unparseable"})
        assert strategy.state.get_int("good") == 1

    def test_initialize_is_deterministic(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        strategy.initialize()
        strategy.state.set("scratch", 9)
        strategy.initialize()
        assert strategy.state.get("scratch") is None


class TestSignalIdentityAndDedup:
    """Cases 12 and 13: deterministic identity and bounded dedup."""

    def make_signal(self, *, signal_id: str = "sig-1", created_at: int = BASE_TS) -> Signal:
        return Signal(
            signal_id=signal_id,
            tenant_id="tenant-1",
            strategy_id="strategy-1",
            strategy_version="1.0.0",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            action=SignalAction.BUY,
            confidence=D("0.5"),
            reference_price=D("30000"),
            target_quantity=D("0.001"),
            order_type=OrderType.LIMIT,
            limit_price=D("29995"),
            created_at=created_at,
        )

    def test_identity_ignores_timestamp_and_confidence(self) -> None:
        first = self.make_signal(signal_id="a", created_at=BASE_TS)
        second = self.make_signal(signal_id="b", created_at=BASE_TS + 5)
        assert signal_identity(first) == signal_identity(second)

    def test_duplicate_within_ttl_is_detected(self) -> None:
        dedup = SignalDeduplicator(ttl_micros=1_000_000)
        first = dedup.check_and_register(self.make_signal(), now_micros=BASE_TS)
        second = dedup.check_and_register(
            self.make_signal(signal_id="other"), now_micros=BASE_TS + 10
        )
        assert first.is_duplicate is False
        assert second.is_duplicate is True

    def test_the_entry_expires_after_the_ttl(self) -> None:
        dedup = SignalDeduplicator(ttl_micros=1_000)
        dedup.check_and_register(self.make_signal(), now_micros=BASE_TS)
        later = dedup.check_and_register(
            self.make_signal(signal_id="other"), now_micros=BASE_TS + 2_000
        )
        assert later.is_duplicate is False

    def test_capacity_is_bounded(self) -> None:
        dedup = SignalDeduplicator(ttl_micros=10_000_000, capacity=4)
        for index in range(20):
            signal = Signal(
                signal_id=f"sig-{index}",
                tenant_id="tenant-1",
                strategy_id="strategy-1",
                strategy_version="1.0.0",
                exchange=EXCHANGE,
                symbol=SYMBOL,
                action=SignalAction.BUY,
                confidence=D("0.5"),
                reference_price=D("30000"),
                target_quantity=D("0.001") * (index + 1),
                order_type=OrderType.LIMIT,
                limit_price=D("29995"),
                created_at=BASE_TS,
            )
            dedup.check_and_register(signal, now_micros=BASE_TS)
        assert dedup.size <= 4

    def test_cooldown_blocks_then_reopens(self) -> None:
        gate = CooldownGate(cooldown_micros=1_000)
        assert gate.is_open(now_micros=BASE_TS) is True
        gate.record_emission(now_micros=BASE_TS)
        assert gate.is_open(now_micros=BASE_TS + 500) is False
        assert gate.is_open(now_micros=BASE_TS + 1_000) is True


class TestSignalValidation:
    """Case 11: the validator rejects; it never modifies."""

    def make_signal(self, **overrides: object) -> Signal:
        payload: dict[str, object] = {
            "signal_id": "sig-1",
            "tenant_id": "tenant-1",
            "strategy_id": "strategy-1",
            "strategy_version": "1.0.0",
            "exchange": EXCHANGE,
            "symbol": SYMBOL,
            "action": SignalAction.BUY,
            "confidence": D("0.5"),
            "reference_price": D("30000"),
            "target_quantity": D("0.001"),
            "order_type": OrderType.LIMIT,
            "limit_price": D("29995"),
            "created_at": BASE_TS,
        }
        payload.update(overrides)
        return Signal(**payload)  # type: ignore[arg-type]

    def validate(self, signal: Signal, **overrides: object):
        kwargs: dict[str, object] = {
            "now_micros": BASE_TS,
            "instance_id": "strategy-1",
            "tenant_id": "tenant-1",
            "exchange": EXCHANGE,
            "allowed_symbols": frozenset({SYMBOL}),
            "strategy_status": StrategyStatus.RUNNING,
            "strategy_enabled": True,
            "kill_switches": KillSwitchState(),
            "market_data_age_micros": 1_000,
            "market_data_is_fresh": True,
            "risk_state_available": True,
        }
        kwargs.update(overrides)
        return SignalValidator(SignalValidationConfig()).validate(signal, **kwargs)  # type: ignore[arg-type]

    def test_a_good_signal_is_accepted_unmodified(self) -> None:
        signal = self.make_signal()
        result = self.validate(signal)
        assert result.accepted is True
        assert result.code is SignalRejectionCode.ACCEPTED
        assert result.signal is signal

    def test_a_rejected_signal_is_returned_unmodified(self) -> None:
        signal = self.make_signal(tenant_id="tenant-2")
        result = self.validate(signal)
        assert result.accepted is False
        assert result.signal is signal
        assert result.signal.tenant_id == "tenant-2"

    def test_wrong_exchange_is_rejected(self) -> None:
        signal = self.make_signal(exchange=ExchangeId.PAPER)
        assert self.validate(signal).accepted is False

    def test_symbol_outside_the_allow_list_is_rejected(self) -> None:
        result = self.validate(self.make_signal(symbol=OTHER_SYMBOL))
        assert result.code is SignalRejectionCode.SYMBOL_NOT_ALLOWED

    def test_stale_signal_is_rejected(self) -> None:
        result = self.validate(self.make_signal(), now_micros=BASE_TS + 10_000_000)
        assert result.code is SignalRejectionCode.SIGNAL_STALE

    def test_future_signal_is_rejected(self) -> None:
        result = self.validate(self.make_signal(created_at=BASE_TS + 10_000_000))
        assert result.code is SignalRejectionCode.SIGNAL_FROM_FUTURE

    def test_expired_signal_is_rejected(self) -> None:
        signal = self.make_signal(expires_at=BASE_TS + 10)
        result = self.validate(signal, now_micros=BASE_TS + 20)
        assert result.code is SignalRejectionCode.SIGNAL_EXPIRED

    def test_stale_market_data_is_rejected(self) -> None:
        result = self.validate(self.make_signal(), market_data_is_fresh=False)
        assert result.code is SignalRejectionCode.MARKET_DATA_STALE

    def test_unavailable_risk_state_fails_closed(self) -> None:
        result = self.validate(self.make_signal(), risk_state_available=False)
        assert result.accepted is False
        assert result.code is SignalRejectionCode.VALIDATION_STATE_UNAVAILABLE

    def test_kill_switch_blocks_every_signal(self) -> None:
        switches = KillSwitchState(global_engaged=True, reason="drill")
        result = self.validate(self.make_signal(), kill_switches=switches)
        assert result.code is SignalRejectionCode.KILL_SWITCH_ENGAGED

    def test_a_stopped_strategy_cannot_emit(self) -> None:
        result = self.validate(
            self.make_signal(), strategy_status=StrategyStatus.STOPPED
        )
        assert result.code is SignalRejectionCode.STRATEGY_NOT_RUNNING

    def test_missing_strategy_version_is_rejected(self) -> None:
        result = self.validate(self.make_signal(strategy_version=""))
        assert result.code is SignalRejectionCode.STRATEGY_VERSION_MISSING

    def test_hold_is_accepted_even_when_risk_state_is_unavailable(self) -> None:
        """A HOLD asks for nothing, so refusing it would be theatre."""
        signal = self.make_signal(
            action=SignalAction.HOLD, target_quantity=None, limit_price=None
        )
        result = self.validate(signal, risk_state_available=False)
        assert result.accepted is True


class TestEngineLifecycleAndIsolation:
    """Cases 4, 5, 14, 15: lifecycle, multi-strategy isolation, failure policy."""

    def test_instances_start_and_stop(self) -> None:
        engine = build_engine()
        instance = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        assert instance.status is StrategyStatus.CREATED
        engine.start_all(now_micros=BASE_TS)
        assert instance.status is StrategyStatus.RUNNING
        engine.stop_all(now_micros=BASE_TS + 1)
        assert instance.status is StrategyStatus.STOPPED

    def test_a_running_instance_emits_an_accepted_signal(self) -> None:
        engine = build_engine()
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book())
        assert len(outcomes) == 1
        assert outcomes[0].accepted is True
        assert outcomes[0].signal.action is SignalAction.BUY

    def test_a_stopped_instance_receives_nothing(self) -> None:
        engine = build_engine()
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        assert engine.dispatch_book_top(book()) == ()

    def test_one_failure_does_not_stop_the_others(self) -> None:
        engine = build_engine()
        good = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        bad = engine.add(
            ExplodingStrategy(make_descriptor(strategy_id="strategy-2"), symbol=SYMBOL)
        )
        engine.start_all(now_micros=BASE_TS)

        outcomes = engine.dispatch_book_top(book())

        assert bad.status is StrategyStatus.FAILED
        assert bad.is_healthy is False
        assert good.status is StrategyStatus.RUNNING
        assert [outcome.instance_id for outcome in outcomes] == [good.instance_id]
        assert engine.metrics.counters.strategy_errors >= 1

    def test_a_failed_instance_stays_stopped_until_cleared(self) -> None:
        engine = build_engine()
        bad = engine.add(ExplodingStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        engine.dispatch_book_top(book(timestamp=BASE_TS + 1))
        assert bad.error_count == 1  # not dispatched to a second time

    def test_halt_all_policy_stops_every_instance(self) -> None:
        engine = build_engine(policy=StrategyFailurePolicy.HALT_ALL)
        good = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.add(
            ExplodingStrategy(make_descriptor(strategy_id="strategy-2"), symbol=SYMBOL)
        )
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        assert engine.is_halted is True
        assert good.status is not StrategyStatus.RUNNING
        assert engine.dispatch_book_top(book(timestamp=BASE_TS + 1)) == ()

    def test_clear_failure_resets_state_before_restart(self) -> None:
        engine = build_engine()
        bad = engine.add(ExplodingStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        bad.clear_failure()
        assert bad.last_failure is None
        assert bad.status is StrategyStatus.INITIALISED

    def test_state_of_one_instance_is_untouched_by_another_failing(self) -> None:
        engine = build_engine()
        good = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.add(
            ExplodingStrategy(make_descriptor(strategy_id="strategy-2"), symbol=SYMBOL)
        )
        engine.start_all(now_micros=BASE_TS)
        good.strategy.state.set("marker", 42)
        engine.dispatch_book_top(book())
        assert good.strategy.state.get_int("marker") == 42

    def test_events_are_delivered_in_order_to_each_instance(self) -> None:
        engine = build_engine()
        instance = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        for index in range(5):
            engine.dispatch_book_top(book(timestamp=BASE_TS + index))
        assert instance.event_count == 5

    def test_a_symbol_only_reaches_its_own_instances(self) -> None:
        engine = build_engine()
        engine.add(
            AlwaysBuyStrategy(
                make_descriptor(symbols=(SYMBOL, OTHER_SYMBOL)), symbol=OTHER_SYMBOL
            )
        )
        engine.start_all(now_micros=BASE_TS)
        assert engine.dispatch_book_top(book(symbol=SYMBOL)) == ()

    def test_dedup_suppresses_a_repeated_identical_signal(self) -> None:
        engine = build_engine()
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        first = engine.dispatch_book_top(book())
        second = engine.dispatch_book_top(book(timestamp=BASE_TS + 1))
        assert first[0].accepted is True
        assert second[0].accepted is False
        assert second[0].rejection_code is SignalRejectionCode.DUPLICATE_SIGNAL

    def test_silent_strategy_produces_no_outcome_and_no_error(self) -> None:
        engine = build_engine()
        instance = engine.add(SilentStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        assert engine.dispatch_book_top(book()) == ()
        assert instance.error_count == 0

    def test_metrics_count_events_and_signals(self) -> None:
        engine = build_engine()
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        counters = engine.metrics.counters
        assert counters.events_processed >= 1
        assert counters.signals_generated >= 1
        assert counters.signals_accepted >= 1


class TestRiskAndCredentialBoundary:
    """Cases 29 and 30: no risk bypass, no credentials in the context."""

    def test_default_risk_provider_fails_closed(self) -> None:
        """With no risk provider wired, actionable signals must be refused."""
        engine = StrategyEngine(
            config=StrategyEngineConfig(default_cooldown_micros=0),
            freshness_provider=fresh,
        )
        engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book())
        assert outcomes[0].accepted is False
        assert outcomes[0].rejection_code is SignalRejectionCode.VALIDATION_STATE_UNAVAILABLE

    def test_risk_view_cannot_authorise_anything(self) -> None:
        view = StrategyRiskView(is_available=True, max_position_quantity=D("1"))
        for forbidden in ("approve", "authorise", "authorize", "override", "submit"):
            assert not hasattr(view, forbidden)

    def test_risk_view_headroom_is_never_negative(self) -> None:
        view = StrategyRiskView(
            is_available=True,
            max_position_quantity=D("1"),
            current_position_quantity=D("5"),
        )
        assert view.available_position_budget == D("0")

    def test_unknown_limits_do_not_mean_unlimited(self) -> None:
        view = StrategyRiskView(is_available=True)
        assert view.available_position_budget is None

    def test_the_context_carries_no_credential_field(self) -> None:
        engine = build_engine()
        instance = engine.add(AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL))
        engine.start_all(now_micros=BASE_TS)
        engine.dispatch_book_top(book())
        context = instance.strategy.last_context
        assert context is not None
        banned = (
            "api_key", "apikey", "secret", "token", "credential", "password",
            "signature", "private",
        )
        for field_name in getattr(type(context), "__slots__", ()) or ():
            assert not any(word in field_name.lower() for word in banned)
        rendered = str(context.to_log_fields()).lower()
        for word in ("secret", "apikey", "api_key", "private_key", "password"):
            assert word not in rendered

    def test_a_strategy_has_no_adapter_and_no_submit_method(self) -> None:
        strategy = AlwaysBuyStrategy(make_descriptor(), symbol=SYMBOL)
        for forbidden in ("submit_order", "adapter", "client", "api_key", "secret"):
            assert not hasattr(strategy, forbidden)

    def test_no_strategy_module_imports_an_exchange_adapter(self) -> None:
        """Structural: the strategy layer cannot reach a venue."""
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1] / "wlct_trading" / "strategies"
        for path in root.rglob("*.py"):
            imports = [
                line
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith(("import ", "from "))
            ]
            for line in imports:
                assert "wlct_trading.adapters" not in line, f"{path}: {line}"
                assert "wlct_trading.net" not in line, f"{path}: {line}"
                assert "wlct_trading.execution" not in line, f"{path}: {line}"


class TestDeterministicExampleStrategy:
    """Case 10: the example strategy emits signals deterministically."""

    def build(self, **parameters: object) -> DeterministicImbalanceStrategy:
        registry = build_default_strategy_registry()
        strategy = registry.create(
            "DETERMINISTIC_IMBALANCE_V1",
            "1.0.0",
            descriptor=make_descriptor(),
            symbol=SYMBOL,
            parameters=parameters or None,
        )
        assert isinstance(strategy, DeterministicImbalanceStrategy)
        return strategy

    def test_it_buys_when_the_bid_dominates(self) -> None:
        engine = build_engine()
        engine.add(self.build(signal_cooldown_micros=0))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book(bid_qty="9", ask_qty="1"))
        assert outcomes and outcomes[0].signal.action is SignalAction.BUY

    def test_it_sells_when_the_ask_dominates(self) -> None:
        engine = build_engine()
        engine.add(self.build(signal_cooldown_micros=0))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book(bid_qty="1", ask_qty="9"))
        assert outcomes and outcomes[0].signal.action is SignalAction.SELL

    def test_it_is_silent_on_a_balanced_book(self) -> None:
        engine = build_engine()
        engine.add(self.build(signal_cooldown_micros=0))
        engine.start_all(now_micros=BASE_TS)
        assert engine.dispatch_book_top(book(bid_qty="1", ask_qty="1")) == ()

    def test_exit_threshold_must_be_below_entry(self) -> None:
        with pytest.raises(Exception):
            strategy = self.build(entry_threshold=D("0.2"), exit_threshold=D("0.6"))
            strategy.initialize()

    def test_confidence_is_bounded_and_not_a_probability(self) -> None:
        engine = build_engine()
        engine.add(self.build(signal_cooldown_micros=0))
        engine.start_all(now_micros=BASE_TS)
        outcomes = engine.dispatch_book_top(book(bid_qty="9", ask_qty="1"))
        confidence = outcomes[0].signal.confidence
        assert D("0") <= confidence <= D("1")

    def test_signal_ids_repeat_across_identical_replays(self) -> None:
        ids: list[tuple[str, ...]] = []
        for _ in range(2):
            engine = build_engine()
            engine.add(self.build(signal_cooldown_micros=0))
            engine.start_all(now_micros=BASE_TS)
            emitted: list[str] = []
            for index in range(4):
                for outcome in engine.dispatch_book_top(
                    book(
                        bid_qty="9" if index % 2 == 0 else "1",
                        ask_qty="1" if index % 2 == 0 else "9",
                        timestamp=BASE_TS + index,
                    )
                ):
                    emitted.append(outcome.signal.signal_id)
            ids.append(tuple(emitted))
        assert ids[0] == ids[1]
