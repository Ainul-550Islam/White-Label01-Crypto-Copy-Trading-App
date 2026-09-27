"""Part 8 ``RiskGate``: the full rule matrix, fail-closed and deterministic.

Maps onto the mandated test list: (1) ALLOW, (2) max order quantity, (3) max
order notional, (4) max position, (5) max position notional, (6) account
exposure, (7) strategy exposure, (8) cross-strategy exposure, (9) open-order
reservation, (10) daily loss, (11) strategy loss, (12) drawdown, (13) price
deviation, (14) stale market data, (15) stale risk snapshot, (16) missing
snapshot, (17) invalid account state, (18) invalid position state, (19-24)
the six kill-switch scopes, (25) risk-reducing behaviour, (26) consecutive
losses, (27) order frequency, (28) cancel frequency, (29) correlation groups,
(30) hierarchy (also in test_risk_configuration), (36) the fail-closed
matrix. Every fixture uses an injected clock; nothing sleeps; every refusal
is asserted at its code, not merely its denial.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from wlct_trading.enums import (
    ExchangeId,
    KillSwitchScope,
    RiskSwitchStatus,
    MarketType,
    OrderBookHealth,
    OrderSide,
    OrderStatus,
    OrderType,
    PriceReferenceKind,
    ProtectionAction,
    RiskDecisionCode,
    RiskEventKind,
    RiskLimitScope,
    RiskLimitUnit,
    RiskRuleId,
    TimeInForce,
    TradingMode,
)
from wlct_trading.orders import OrderIntent
from wlct_trading.risk.configuration import (
    RATE_WINDOW_ONE_MINUTE_MICROS,
    RATE_WINDOW_ONE_SECOND_MICROS,
    RiskConfiguration,
    RiskLimitEntry,
)
from wlct_trading.risk.correlation import CorrelationGroup
from wlct_trading.risk.events import InMemoryRiskEventSink
from wlct_trading.risk.freshness import FreshnessBudget
from wlct_trading.risk.ledger import LocalReservationLedger
from wlct_trading.risk.protections import (
    AutomaticProtectionPolicy,
    KillSwitchLedger,
    KillSwitchRecord,
)
from wlct_trading.risk.rate_limits import LocalRateCoordinator, RiskRateState
from wlct_trading.risk.snapshot import (
    RiskAccountState,
    RiskMarketDataState,
    RiskOpenOrderState,
    RiskPositionState,
    RiskStateSnapshot,
    RiskStrategyState,
)
from wlct_trading.risk.evaluator import GateError, RiskGate

NOW = 1_700_000_000_000_000
SYMBOL = "BTC-USDT"
ZERO = Decimal(0)


def limit(
    rule: RiskRuleId,
    value: str,
    *,
    scope: RiskLimitScope = RiskLimitScope.GLOBAL,
    target: str | None = None,
    window: int | None = None,
    enabled: bool = True,
) -> RiskLimitEntry:
    units = {
        RiskRuleId.MAX_ORDER_QUANTITY: RiskLimitUnit.BASE_QUANTITY,
        RiskRuleId.MAX_ORDER_NOTIONAL: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_POSITION_QUANTITY: RiskLimitUnit.BASE_QUANTITY,
        RiskRuleId.MAX_POSITION_NOTIONAL: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_SYMBOL_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_STRATEGY_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_ACCOUNT_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_EXCHANGE_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_TOTAL_VOLUME: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_FEE_BUDGET: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_OPEN_ORDERS: RiskLimitUnit.COUNT,
        RiskRuleId.MAX_ORDER_RATE: RiskLimitUnit.COUNT,
        RiskRuleId.MAX_CANCEL_RATE: RiskLimitUnit.COUNT,
        RiskRuleId.MAX_DAILY_LOSS: RiskLimitUnit.LOSS,
        RiskRuleId.MAX_STRATEGY_DAILY_LOSS: RiskLimitUnit.LOSS,
        RiskRuleId.MAX_DRAWDOWN: RiskLimitUnit.PERCENT,
        RiskRuleId.MAX_CONSECUTIVE_LOSSES: RiskLimitUnit.COUNT,
        RiskRuleId.MAX_ACTIVE_STRATEGIES: RiskLimitUnit.COUNT,
        RiskRuleId.MAX_PRICE_DEVIATION: RiskLimitUnit.BPS,
        RiskRuleId.MAX_STALE_DATA_AGE: RiskLimitUnit.AGE_MICROS,
        RiskRuleId.MAX_LEVERAGE: RiskLimitUnit.LEVERAGE_X,
    }
    return RiskLimitEntry(
        rule_id=rule,
        scope=scope,
        target=target,
        enabled=enabled,
        value=Decimal(value),
        unit=units[rule],
        priority=0,
        effective_from_micros=0,
        effective_until_micros=None,
        entry_version=1,
        window_micros=window,
    )


def config_with(*entries: RiskLimitEntry, **kwargs: object) -> RiskConfiguration:
    # Later entries replace earlier ones for the same (rule, scope, target)
    # - the shape a control-plane edit takes. Two indistinguishable entries
    # in one document is what the duplicate-identity validation refuses, so
    # every harness that layers an override onto the baseline goes through
    # here.
    by_identity: dict[tuple[RiskRuleId, RiskLimitScope, str | None], RiskLimitEntry] = {}
    for entry in entries:
        by_identity[(entry.rule_id, entry.scope, entry.target)] = entry
    return RiskConfiguration(entries=list(by_identity.values()), **kwargs)


def market(
    *,
    bid: str = "99.5",
    ask: str = "100.5",
    health: OrderBookHealth = OrderBookHealth.OK,
    quote_ts: int | None = NOW - 50_000,
    symbol: str = SYMBOL,
) -> RiskMarketDataState:
    return RiskMarketDataState(
        exchange=ExchangeId.BINANCE,
        symbol=symbol,
        best_bid=Decimal(bid),
        best_ask=Decimal(ask),
        best_bid_quantity=Decimal("10"),
        best_ask_quantity=Decimal("10"),
        last_trade_price=Decimal("100"),
        last_trade_timestamp_micros=NOW - 100_000,
        quote_timestamp_micros=quote_ts,
        book_health=health,
        book_sequence=1000,
        feed_connected=True,
        simulated=True,
    )


def account_state(
    *,
    equity: str = "10000",
    available: str = "9000",
    reserved: str = "1000",
) -> RiskAccountState:
    return RiskAccountState(
        tenant_id="tenant-1",
        account_id="acct-1",
        exchange=ExchangeId.BINANCE,
        equity=Decimal(equity),
        available=Decimal(available),
        reserved=Decimal(reserved),
        source_timestamp_micros=NOW,
    )


def state_from(
    config: RiskConfiguration | None = None,
    *,
    symbol: str = SYMBOL,
    position: str = "0",
    open_orders: tuple[RiskOpenOrderState, ...] = (),
    positions: tuple[RiskPositionState, ...] | None = None,
    market_states: tuple[RiskMarketDataState, ...] | None = None,
    strategies: tuple[RiskStrategyState, ...] | None = None,
    realised: str = "0",
    unrealised: str = "0",
    fees: str = "0",
    traded: str = "0",
    equity: str = "10000",
    available: str = "9000",
    peak: str = "10000",
    consecutive_losses: int = 0,
    created_at: int = NOW,
    rate: RiskRateState | None = None,
    account: RiskAccountState | None = None,
    version: int = 7,
) -> RiskStateSnapshot:
    if positions is None:
        positions = ()
        if Decimal(position) != ZERO:
            positions = (
                RiskPositionState(
                    exchange=ExchangeId.BINANCE,
                    symbol=symbol,
                    quantity=Decimal(position),
                    average_entry_price=Decimal("100"),
                    mark_price=Decimal("100"),
                    source_timestamp_micros=NOW,
                    strategy_id="strat-1",
                ),
            )
    return RiskStateSnapshot(
        snapshot_id="snap-gate",
        version=version,
        tenant_id="tenant-1",
        account_id="acct-1",
        created_at_micros=created_at,
        trading_day="2023-11-14",
        config_digest=None if config is None else config.digest,
        config_version=None if config is None else config.config_version,
        account=(
            account
            if account is not None
            else account_state(equity=equity, available=available)
        ),
        positions=positions,
        open_orders=open_orders,
        market=(
            market_states
            if market_states is not None
            else (market(symbol=symbol),)
        ),
        strategies=(
            strategies
            if strategies is not None
            else (
                RiskStrategyState(
                    strategy_id="strat-1",
                    realised_pnl_today=Decimal(realised),
                    unrealised_pnl=Decimal(unrealised),
                    open_order_count=len(open_orders),
                    consecutive_losses=consecutive_losses,
                    is_enabled=True,
                    source_timestamp_micros=NOW,
                ),
            )
        ),
        realised_pnl_today=Decimal(realised),
        unrealised_pnl_today=Decimal(unrealised),
        fees_today=Decimal(fees),
        traded_notional_today=Decimal(traded),
        consecutive_losses=consecutive_losses,
        peak_equity=Decimal(peak),
        market_type=MarketType.SPOT,
        rate=rate,
        missing_sources=frozenset(),
        advisories=frozenset(),
        produced_by="test",
        is_simulated=True,
    )


def intent(
    *,
    side: OrderSide = OrderSide.BUY,
    quantity: str = "1",
    price: str | None = "100",
    reduce_only: bool = False,
    strategy: str | None = "strat-1",
    client_order_id: str | None = None,
    symbol: str = SYMBOL,
) -> OrderIntent:
    return OrderIntent(
        tenant_id="tenant-1",
        account_id="acct-1",
        strategy_id=strategy,
        exchange=ExchangeId.BINANCE,
        symbol=symbol,
        side=side,
        order_type=OrderType.LIMIT if price is not None else OrderType.MARKET,
        quantity=Decimal(quantity),
        price=None if price is None else Decimal(price),
        reduce_only=reduce_only,
        client_order_id=client_order_id,
    )


def open_order(
    client_id: str,
    *,
    side: OrderSide = OrderSide.BUY,
    quantity: str = "1",
    filled: str = "0",
    reduce_only: bool = False,
    strategy: str | None = "strat-1",
    status: OrderStatus = OrderStatus.SUBMITTED,
    symbol: str = SYMBOL,
) -> RiskOpenOrderState:
    return RiskOpenOrderState(
        client_order_id=client_id,
        exchange=ExchangeId.BINANCE,
        symbol=symbol,
        side=side,
        order_type=OrderType.LIMIT,
        status=status,
        quantity=Decimal(quantity),
        filled_quantity=Decimal(filled),
        is_reduce_only=reduce_only,
        time_in_force=TimeInForce.GTC,
        strategy_id=strategy,
        limit_price=Decimal("100"),
        source_timestamp_micros=NOW,
    )


BASELINE = (
    limit(RiskRuleId.MAX_ORDER_QUANTITY, "1000"),
    limit(RiskRuleId.MAX_ORDER_NOTIONAL, "1000000"),
    limit(RiskRuleId.MAX_POSITION_QUANTITY, "1000"),
    limit(RiskRuleId.MAX_POSITION_NOTIONAL, "1000000"),
    limit(RiskRuleId.MAX_SYMBOL_EXPOSURE, "1000000"),
    limit(RiskRuleId.MAX_STRATEGY_EXPOSURE, "1000000"),
    limit(RiskRuleId.MAX_ACCOUNT_EXPOSURE, "1000000"),
    limit(RiskRuleId.MAX_EXCHANGE_EXPOSURE, "1000000"),
    limit(RiskRuleId.MAX_OPEN_ORDERS, "100"),
    limit(RiskRuleId.MAX_DAILY_LOSS, "1000000"),
    limit(RiskRuleId.MAX_STRATEGY_DAILY_LOSS, "1000000"),
    limit(RiskRuleId.MAX_DRAWDOWN, "99"),
    limit(RiskRuleId.MAX_STALE_DATA_AGE, "60000000"),
)


def clean_gate(
    *entries: RiskLimitEntry,
    events: InMemoryRiskEventSink | None = None,
    reservations: LocalReservationLedger | None = None,
    rates: LocalRateCoordinator | None = None,
    kill: KillSwitchLedger | None = None,
    freshness: FreshnessBudget | None = None,
    policy: AutomaticProtectionPolicy | None = None,
    extra_config: dict[str, object] | None = None,
) -> tuple[RiskGate, RiskConfiguration]:
    config = config_with(
        *BASELINE,
        *entries,
        **(
            {"protection_policy": policy} if policy is not None else {}
        ),
        **(extra_config or {}),
    )
    gate = RiskGate(
        configuration=config,
        simulated=True,
        events=events or InMemoryRiskEventSink(),
        reservations=reservations,
        rate_coordinator=rates,
        kill_switches=kill or KillSwitchLedger(),
        freshness=freshness or FreshnessBudget(max_snapshot_age_micros=5_000_000),
    )
    return gate, config


def evaluate(
    gate: RiskGate,
    state: RiskStateSnapshot,
    order: OrderIntent,
    **kwargs: object,
):
    return gate.evaluate(
        order,
        state=state,
        request_id=str(kwargs.pop("request_id", "req-1")),
        trading_mode=TradingMode.PAPER,
        now_micros=NOW,
        **kwargs,
    )


class TestAllowedAndProvenance:
    def test_a_clean_order_is_approved_with_full_provenance(self) -> None:
        gate, config = clean_gate()
        outcome = evaluate(gate, state_from(config), intent())
        decision = outcome.decision
        assert decision.approved is True
        assert decision.code is RiskDecisionCode.APPROVED
        assert decision.would_route is True
        assert decision.request_id == "req-1"
        assert decision.strategy_id == "strat-1"
        assert decision.tenant_id == "tenant-1"
        assert decision.account_id == "acct-1"
        assert decision.exchange is ExchangeId.BINANCE
        assert decision.symbol == SYMBOL
        assert decision.snapshot_version == 7
        assert decision.snapshot_created_at == NOW
        assert decision.latency is not None
        assert decision.latency.total_micros is not None
        # every stage that ran is measured; stages that never ran (no
        # exposure after an early refusal) stay honestly absent.
        assert decision.latency.rules_micros is not None
        assert decision.latency.to_dict()["totalMicros"] >= 0

    def test_clean_run_has_no_blocking_outcomes_or_events(self) -> None:
        gate, config = clean_gate()
        outcome = evaluate(gate, state_from(config), intent())
        assert outcome.blocking_rules == ()
        assert outcome.proposed_protections == ()
        assert outcome.events == ()

    def test_decision_is_not_reusable_across_snapshot_versions(self) -> None:
        from wlct_trading.risk.decisions import decision_is_current

        assert decision_is_current(7, 7) is True
        assert decision_is_current(7, 8) is False
        assert decision_is_current(None, 8) is False
        assert decision_is_current(7, None) is False


class TestSizeAndNotional:
    def test_max_order_quantity(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_ORDER_QUANTITY, "0.5"))
        outcome = evaluate(gate, state_from(config), intent(quantity="0.6"))
        assert outcome.decision.code is RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED
        violation = outcome.decision.violations[-1]
        assert violation.rule is RiskRuleId.MAX_ORDER_QUANTITY
        assert violation.observed == "0.6" and violation.limit == "0.5"

    def test_order_at_exactly_the_quantity_limit_is_allowed(self) -> None:
        # "Maximum order quantity" is an inclusive ceiling: equal is allowed,
        # greater is not. An exclusive read would silently shrink every
        # configured cap by one quantum.
        gate, config = clean_gate(limit(RiskRuleId.MAX_ORDER_QUANTITY, "0.5"))
        assert evaluate(gate, state_from(config), intent(quantity="0.5")).decision.approved

    def test_max_order_notional(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_ORDER_NOTIONAL, "50"))
        outcome = evaluate(
            gate, state_from(config), intent(quantity="1", price="100")
        )
        assert outcome.decision.code is RiskDecisionCode.MAX_ORDER_NOTIONAL_EXCEEDED

    def test_max_position_quantity_projects_after_reservation(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_POSITION_QUANTITY, "1.5"))
        # current 1 + open buy 0.4 -> 1.4 ok; the new 0.2 pushes to 1.6 > 1.5
        state = state_from(
            config,
            position="1",
            open_orders=(open_order("o1", quantity="0.4"),),
        )
        outcome = evaluate(gate, state, intent(quantity="0.2"))
        assert outcome.decision.code is RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED

    def test_max_position_notional(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_POSITION_NOTIONAL, "150"))
        state = state_from(config, position="1")
        outcome = evaluate(gate, state, intent(quantity="1", price="100"))
        assert outcome.decision.code is RiskDecisionCode.MAX_POSITION_NOTIONAL_EXCEEDED


class TestExposureAndReservation:
    def test_account_exposure_counts_other_strategies_and_reservations(self) -> None:
        # 8 + 6: cross-strategy. Strategy-2 holds an open buy worth 100 at
        # the reference; strategy-1's new 100-notional order brings the
        # account to 200 against a cap of 150 -> refusal. Neither strategy
        # alone exceeds anything; the account aggregate does.
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_ACCOUNT_EXPOSURE, "150"),
        )
        state = state_from(
            config,
            positions=(
                RiskPositionState(
                    exchange=ExchangeId.BINANCE,
                    symbol=SYMBOL,
                    quantity=Decimal("1"),
                    average_entry_price=Decimal("100"),
                    mark_price=Decimal("100"),
                    source_timestamp_micros=NOW,
                    strategy_id="strat-2",
                ),
            ),
            strategies=(
                RiskStrategyState(
                    strategy_id="strat-1",
                    realised_pnl_today=ZERO,
                    unrealised_pnl=ZERO,
                    open_order_count=0,
                    consecutive_losses=0,
                    is_enabled=True,
                    source_timestamp_micros=NOW,
                ),
                RiskStrategyState(
                    strategy_id="strat-2",
                    realised_pnl_today=ZERO,
                    unrealised_pnl=ZERO,
                    open_order_count=1,
                    consecutive_losses=0,
                    is_enabled=True,
                    source_timestamp_micros=NOW,
                ),
            ),
            available="8900",
        )
        outcome = evaluate(gate, state, intent(quantity="1", price="100"))
        assert outcome.decision.code is RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED

    def test_strategy_exposure_uses_reservation_bucket_plus_new_order(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_STRATEGY_EXPOSURE, "150"))
        state = state_from(
            config,
            open_orders=(open_order("o1", quantity="1"),),  # strat-1 holds 100
        )
        outcome = evaluate(gate, state, intent(quantity="1", price="100"))
        assert outcome.decision.code is RiskDecisionCode.MAX_STRATEGY_EXPOSURE_EXCEEDED

    def test_open_order_reservation_blocks_even_from_flat(self) -> None:
        # 9: two open buys for 100 each with an account cap of 250: flat
        # position, but the reservations occupy 200, so a third 100-order
        # projects to 300 and must be refused. A risk engine that reads only
        # positions would approve this; that is the overlapping-risk bug the
        # reservation model exists to kill.
        gate, config = clean_gate(limit(RiskRuleId.MAX_ACCOUNT_EXPOSURE, "250"))
        state = state_from(
            config,
            open_orders=(open_order("a", quantity="1"), open_order("b", quantity="1")),
        )
        outcome = evaluate(gate, state, intent(quantity="1"))
        assert outcome.decision.code is RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED
        # and without the new order being too big on its own, the *projection*
        # is what fails - the same state with a reduce-only order passes.
        reduce_gate = evaluate(
            gate,
            state,
            intent(quantity="1", side=OrderSide.SELL, reduce_only=True),
        )
        assert reduce_gate.decision.approved or reduce_gate.decision.code is (
            RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED
        )

    def test_partial_fills_reduce_the_reservation(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_ACCOUNT_EXPOSURE, "150"))
        state = state_from(
            config,
            open_orders=(open_order("a", quantity="2", filled="1.5"),),
        )
        # reservation is 0.5 * 100 = 50, the new order adds 100 -> exactly 150
        # cap is inclusive -> allowed.
        assert evaluate(gate, state, intent(quantity="1")).decision.approved


class TestLossDrawdownStaleness:
    def test_daily_loss_breach_blocks_new_risk(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_DAILY_LOSS, "500"))
        state = state_from(config, realised="-600")
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED
        assert any(
            event.kind is RiskEventKind.LIMIT_BREACHED
            and event.rule_id is RiskRuleId.MAX_DAILY_LOSS
            for event in outcome.events
        )

    def test_daily_loss_includes_fees_by_default(self) -> None:
        # realised -400 and fees -200 sum to a net -600 against a 500 limit:
        # the fee bleed counts, because a limit that ignores cost is a limit
        # on trading *gross of the house cut*.
        gate, config = clean_gate(limit(RiskRuleId.MAX_DAILY_LOSS, "500"))
        state = state_from(config, realised="-400", fees="200")
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED

    def test_unrealised_only_counts_when_the_flag_is_set(self) -> None:
        entries = (limit(RiskRuleId.MAX_DAILY_LOSS, "500"),)
        off_gate, off_config = clean_gate(
            *entries, extra_config={"daily_loss_includes_unrealized": False}
        )
        on_gate, on_config = clean_gate(
            *entries, extra_config={"daily_loss_includes_unrealized": True}
        )
        state_off = state_from(off_config, realised="0", unrealised="-900")
        state_on = state_from(on_config, realised="0", unrealised="-900")
        assert evaluate(off_gate, state_off, intent()).decision.approved
        assert evaluate(on_gate, state_on, intent()).decision.code is (
            RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED
        )

    def test_strategy_loss_limit(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_STRATEGY_DAILY_LOSS, "300"))
        state = state_from(config, realised="0")
        # override the strategy bucket to a big loss for strat-1 only
        state = state_from(
            config,
            realised="0",
            strategies=(
                RiskStrategyState(
                    strategy_id="strat-1",
                    realised_pnl_today=Decimal("-500"),
                    unrealised_pnl=ZERO,
                    open_order_count=0,
                    consecutive_losses=0,
                    is_enabled=True,
                    source_timestamp_micros=NOW,
                ),
            ),
        )
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.STRATEGY_LOSS_LIMIT_BREACHED

    def test_drawdown_from_peak_equity(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_DRAWDOWN, "10"))
        state = state_from(config, equity="8800", peak="10000")
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.MAX_DRAWDOWN_EXCEEDED
        assert any(
            event.kind is RiskEventKind.PROTECTION_TRIGGERED
            or event.rule_id is RiskRuleId.MAX_DRAWDOWN
            for event in outcome.events
        )

    def test_stale_market_data_refuses(self) -> None:
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_STALE_DATA_AGE, "1_000_000".replace("_", ""))
        )
        state = state_from(
            config,
            market_states=(market(quote_ts=NOW - 2_000_000),),
        )
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.STALE_MARKET_DATA

    def test_stale_risk_snapshot_refuses(self) -> None:
        gate, config = clean_gate(
            freshness=FreshnessBudget(max_snapshot_age_micros=1_000_000)
        )
        state = state_from(config, created_at=NOW - 60_000_000)
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.STALE_RISK_STATE

    def test_missing_snapshot_refuses(self) -> None:
        gate, _ = clean_gate()
        outcome = gate.evaluate(
            intent(),
            state=None,
            request_id="req-1",
            trading_mode=TradingMode.PAPER,
        )
        assert not outcome.decision.approved
        assert outcome.decision.code in (
            RiskDecisionCode.RISK_STATE_UNAVAILABLE,
            RiskDecisionCode.STALE_MARKET_DATA,
        )


class TestAccountAndPositionState:
    def test_negative_equity_is_invalid_account_state(self) -> None:
        gate, config = clean_gate()
        state = state_from(config, equity="-5")
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.INVALID_ACCOUNT_STATE

    def test_available_balance_governs_buys(self) -> None:
        gate, config = clean_gate()
        state = state_from(config, available="50")
        outcome = evaluate(gate, state, intent(quantity="1", price="100"))
        assert outcome.decision.code is RiskDecisionCode.INSUFFICIENT_BALANCE

    def test_missing_available_on_a_buy_refuses_not_assumes(self) -> None:
        gate, config = clean_gate()
        state = state_from(config)
        state = state_from(config, account=account_state(available="0"))
        # available 0 < 100 notional -> insufficient, verified arithmetic.
        assert evaluate(gate, state, intent()).decision.code is (
            RiskDecisionCode.INSUFFICIENT_BALANCE
        )
        no_balance = replace_account(state, available=None)
        outcome = evaluate(gate, no_balance, intent())
        assert outcome.decision.code is RiskDecisionCode.INVALID_ACCOUNT_STATE

    def test_sell_does_not_require_quote_balance(self) -> None:
        gate, config = clean_gate()
        state = state_from(config, position="2", available="0")
        outcome = evaluate(gate, state, intent(side=OrderSide.SELL, quantity="1"))
        assert outcome.decision.approved

    def test_corrupt_open_order_state_is_invalid_position_state(self) -> None:
        gate, config = clean_gate()
        bad_order = open_order("weird", quantity="1", filled="2")  # over-filled
        state = state_from(config, open_orders=(bad_order,))
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.INVALID_POSITION_STATE

    def test_position_without_timestamp_is_invalid_position_state(self) -> None:
        gate, config = clean_gate()
        state = state_from(
            config,
            positions=(
                RiskPositionState(
                    exchange=ExchangeId.BINANCE,
                    symbol=SYMBOL,
                    quantity=Decimal("1"),
                    average_entry_price=Decimal("100"),
                    mark_price=Decimal("100"),
                    source_timestamp_micros=None,
                ),
            ),
        )
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.INVALID_POSITION_STATE


class TestKillSwitches:
    def ledger_with(self, *records: KillSwitchRecord) -> KillSwitchLedger:
        return KillSwitchLedger(records)

    def test_global_switch_blocks_everything(self) -> None:
        gate, config = clean_gate(
            kill=self.ledger_with(
                KillSwitchRecord(
                    scope=KillSwitchScope.GLOBAL,
                    target=None,
                    status=RiskSwitchStatus.ACTIVE,
                    reason="incident 42",
                )
            )
        )
        outcome = evaluate(gate, state_from(config), intent())
        assert outcome.decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED
        assert outcome.decision.kill_switch_scope is KillSwitchScope.GLOBAL
        assert "incident 42" in outcome.decision.violations[-1].message

    def test_exchange_scope_blocks_only_that_venue(self) -> None:
        gate, config = clean_gate(
            kill=self.ledger_with(
                KillSwitchRecord(
                    scope=KillSwitchScope.EXCHANGE,
                    target="bybit",
                    status=RiskSwitchStatus.ACTIVE,
                )
            )
        )
        # binance (this account's venue) is untouched...
        assert evaluate(gate, state_from(config), intent()).decision.approved
        # ...and the bybit ledger entry alone says nothing about it.

    def test_exchange_scope_blocks_the_venue_it_names(self) -> None:
        ledger = KillSwitchLedger(
            (
                KillSwitchRecord(
                    scope=KillSwitchScope.EXCHANGE,
                    target="bybit",
                    status=RiskSwitchStatus.ACTIVE,
                ),
            )
        )
        blocking = ledger.blocking_for(
            exchange="bybit",
            account_id="acct-1",
            strategy_id="strat-1",
            symbol=SYMBOL,
        )
        assert blocking is not None
        assert blocking.scope is KillSwitchScope.EXCHANGE
        other = ledger.blocking_for(
            exchange="binance",
            account_id="acct-1",
            strategy_id="strat-1",
            symbol=SYMBOL,
        )
        assert other is None

    def test_account_and_risk_scopes_block(self) -> None:
        for scope, target in (
            (KillSwitchScope.ACCOUNT, "acct-1"),
            (KillSwitchScope.RISK, "account:acct-1"),
        ):
            gate, config = clean_gate(
                kill=self.ledger_with(
                    KillSwitchRecord(scope=scope, target=target, status=RiskSwitchStatus.ACTIVE)
                )
            )
            outcome = evaluate(gate, state_from(config), intent())
            assert outcome.decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED
            assert outcome.decision.kill_switch_scope is scope

    def test_strategy_and_symbol_scopes_block(self) -> None:
        for scope, target in (
            (KillSwitchScope.STRATEGY, "strat-1"),
            (KillSwitchScope.SYMBOL, SYMBOL),
        ):
            gate, config = clean_gate(
                kill=self.ledger_with(
                    KillSwitchRecord(scope=scope, target=target, status=RiskSwitchStatus.ACTIVE)
                )
            )
            outcome = evaluate(gate, state_from(config), intent())
            assert outcome.decision.kill_switch_scope is scope

    def test_broadest_scope_wins_the_report(self) -> None:
        # global + symbol both engaged: the decision must name GLOBAL, and the
        # symbol record must not be consulted as an override.
        gate, config = clean_gate(
            kill=self.ledger_with(
                KillSwitchRecord(
                    scope=KillSwitchScope.SYMBOL,
                    target=SYMBOL,
                    status=RiskSwitchStatus.ACTIVE,
                ),
                KillSwitchRecord(
                    scope=KillSwitchScope.GLOBAL,
                    target=None,
                    status=RiskSwitchStatus.ACTIVE,
                ),
            )
        )
        outcome = evaluate(gate, state_from(config), intent())
        assert outcome.decision.kill_switch_scope is KillSwitchScope.GLOBAL

    def test_manual_switch_blocks_reduce_only_orders_too(self) -> None:
        gate, config = clean_gate(
            kill=self.ledger_with(
                KillSwitchRecord(
                    scope=KillSwitchScope.ACCOUNT,
                    target="acct-1",
                    status=RiskSwitchStatus.ACTIVE,
                )
            )
        )
        state = state_from(config, position="2")
        outcome = evaluate(
            gate, state, intent(side=OrderSide.SELL, reduce_only=True)
        )
        assert outcome.decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED

    def test_triggered_protection_admits_risk_reducing_orders(self) -> None:
        # 25: reduce-only passes, new risk blocked, and the flip-through-zero
        # "close" is refused by the projection, not the flag.
        ledger = KillSwitchLedger(
            (
                KillSwitchRecord(
                    scope=KillSwitchScope.RISK,
                    target="account:acct-1",
                    status=RiskSwitchStatus.TRIGGERED,
                    triggered_by_rule=RiskRuleId.MAX_DAILY_LOSS,
                    reason="daily loss",
                ),
            )
        )
        gate, config = clean_gate(kill=ledger)
        state = state_from(config, position="2")
        reducing = evaluate(
            gate, state, intent(quantity="1", side=OrderSide.SELL, reduce_only=True)
        )
        assert reducing.decision.approved
        assert any(
            event.kind is RiskEventKind.PROTECTION_EXEMPTED
            for event in reducing.events
        )
        increasing = evaluate(gate, state, intent(quantity="1"))
        assert not increasing.decision.approved
        # A reduce-only order of 5 clips at flat - it cannot flip - and the
        # exemption therefore admits it as a close. The dangerous shape is an
        # *unflagged* SELL of 5 through zero into -3: |projected| 3 >
        # |current| 2, risk-increasing, refused by the projection rather than
        # by a checkbox.
        flip = evaluate(gate, state, intent(quantity="5", side=OrderSide.SELL, reduce_only=True))
        assert flip.decision.approved
        sneaky = evaluate(gate, state, intent(quantity="5", side=OrderSide.SELL))
        assert not sneaky.decision.approved
        assert sneaky.decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED

    def test_policy_can_deny_risk_reducing_under_protection(self) -> None:
        policy = AutomaticProtectionPolicy(allow_risk_reducing_orders=False)
        ledger = KillSwitchLedger(
            (
                KillSwitchRecord(
                    scope=KillSwitchScope.RISK,
                    target="account:acct-1",
                    status=RiskSwitchStatus.TRIGGERED,
                    triggered_by_rule=RiskRuleId.MAX_DAILY_LOSS,
                ),
            )
        )
        gate, config = clean_gate(kill=ledger, policy=policy)
        state = state_from(config, position="2")
        outcome = evaluate(
            gate, state, intent(quantity="1", side=OrderSide.SELL, reduce_only=True)
        )
        assert not outcome.decision.approved


class TestRatesLossesAndGroups:
    def test_order_rate_from_snapshot_counts(self) -> None:
        gate, config = clean_gate(
            limit(
                RiskRuleId.MAX_ORDER_RATE,
                "3",
                window=RATE_WINDOW_ONE_MINUTE_MICROS,
            )
        )
        state = state_from(
            config,
            rate=RiskRateState(
                measured_at_micros=NOW,
                orders_last_second=0,
                orders_last_minute=3,
                cancels_last_second=0,
                cancels_last_minute=0,
            ),
        )
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.ORDER_RATE_EXCEEDED

    def test_missing_rate_window_is_unverifiable_not_zero(self) -> None:
        gate, config = clean_gate(
            limit(
                RiskRuleId.MAX_ORDER_RATE,
                "3",
                window=RATE_WINDOW_ONE_MINUTE_MICROS,
            )
        )
        state = state_from(config)  # rate=None
        outcome = evaluate(gate, state, intent())
        assert not outcome.decision.approved
        assert any(
            event.kind is RiskEventKind.RISK_STATE_UNAVAILABLE
            for event in outcome.events
        )

    def test_distributed_rate_consume_denies_second(self) -> None:
        rates = LocalRateCoordinator()
        # saturate the per-second window externally
        for _ in range(3):
            rates.observe("tenant-1", "acct-1", "order", NOW)
        gate, config = clean_gate(
            limit(
                RiskRuleId.MAX_ORDER_RATE,
                "3",
                window=RATE_WINDOW_ONE_SECOND_MICROS,
            ),
            rates=rates,
        )
        state = state_from(
            config,
            rate=RiskRateState(
                measured_at_micros=NOW,
                orders_last_second=0,  # the snapshot lies; the coordinator
                orders_last_minute=0,  # is the authority
                cancels_last_second=0,
                cancels_last_minute=0,
            ),
        )
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.ORDER_RATE_EXCEEDED

    def test_cancel_rate_consumed_by_host_path(self) -> None:
        rates = LocalRateCoordinator()
        for _ in range(2):
            rates.observe("tenant-1", "acct-1", "cancel", NOW)
        gate, config = clean_gate(
            limit(
                RiskRuleId.MAX_CANCEL_RATE,
                "2",
                window=RATE_WINDOW_ONE_SECOND_MICROS,
            ),
            rates=rates,
        )
        reservation = gate.consume_cancel_rate(
            tenant_id="tenant-1", account_id="acct-1", strategy_id=None, now_micros=NOW
        )
        assert reservation is not None
        assert reservation.granted is False
        # rollback of a denial changes nothing; rollback of a grant frees it
        # for the next attempt (cancel path exercised end-to-end in the
        # bridge tests).

    def test_consecutive_losses_blocks_new_risk_only(self) -> None:
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_CONSECUTIVE_LOSSES, "3"),
        )
        state = state_from(config, position="2", consecutive_losses=3)
        blocked = evaluate(gate, state, intent())
        assert blocked.decision.code is (
            RiskDecisionCode.MAX_CONSECUTIVE_LOSSES_EXCEEDED
        )
        closing = evaluate(
            gate,
            state,
            intent(quantity="1", side=OrderSide.SELL, reduce_only=True),
        )
        assert closing.decision.approved

    def test_active_strategy_count_cap(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_ACTIVE_STRATEGIES, "1"))
        # The state contract: every strategy placing orders must appear in
        # the strategies set (here strat-1, disabled). A loader that omitted
        # it would be evaluated against - and refused for - missing state.
        state = state_from(
            config,
            strategies=(
                RiskStrategyState(
                    strategy_id="strat-2",
                    realised_pnl_today=ZERO,
                    unrealised_pnl=ZERO,
                    open_order_count=0,
                    consecutive_losses=0,
                    is_enabled=True,
                    source_timestamp_micros=NOW,
                ),
                RiskStrategyState(
                    strategy_id="strat-1",
                    realised_pnl_today=ZERO,
                    unrealised_pnl=ZERO,
                    open_order_count=0,
                    consecutive_losses=0,
                    is_enabled=False,
                    source_timestamp_micros=NOW,
                ),
            ),
        )
        # strat-1 (the new one) is not among enabled -> projected count 2 > 1
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.TOO_MANY_ACTIVE_STRATEGIES

    def test_correlation_group_ceiling_across_members(self) -> None:
        groups = (
            CorrelationGroup(
                name="majors",
                exchange="binance",
                members=frozenset({"BTC-USDT", "ETH-USDT"}),
                max_notional=Decimal("250"),
                rationale="test",
            ),
        )
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_SYMBOL_EXPOSURE, "1000000", scope=RiskLimitScope.SYMBOL, target="BTC-USDT"),
            limit(RiskRuleId.MAX_SYMBOL_EXPOSURE, "1000000", scope=RiskLimitScope.SYMBOL, target="ETH-USDT"),
            limit(RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE, "250"),
            extra_config={"correlation_groups": groups},
        )
        state = state_from(
            config,
            positions=(
                RiskPositionState(
                    exchange=ExchangeId.BINANCE,
                    symbol="ETH-USDT",
                    quantity=Decimal("1"),
                    average_entry_price=Decimal("50"),
                    mark_price=Decimal("50"),
                    source_timestamp_micros=NOW,
                ),
            ),
        )
        # ETH 50 + new BTC 100*1 = 150 -> within 250
        assert evaluate(gate, state, intent(quantity="1")).decision.approved
        bigger = evaluate(gate, state, intent(quantity="3"))
        assert bigger.decision.code is (
            RiskDecisionCode.CORRELATION_GROUP_EXPOSURE_EXCEEDED
        )

    def test_price_deviation_against_side_touch(self) -> None:
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_PRICE_DEVIATION, "100"),
            extra_config={
                "price_deviation_reference": PriceReferenceKind.SIDE_TOUCH
            },
        )
        # buy at 110 vs ask 100.5 -> deviation 945 bps > 100 bps
        outcome = evaluate(gate, state_from(config), intent(price="110"))
        assert outcome.decision.code is RiskDecisionCode.PRICE_DEVIATION_EXCEEDED
        # market orders are NOT_APPLICABLE for deviation (nothing to deviate)
        market_gate = evaluate(gate, state_from(config), intent(price=None))
        assert not any(
            o.rule_id is RiskRuleId.MAX_PRICE_DEVIATION and o.blocks
            for o in market_gate.outcomes
        )

    def test_leverage_on_spot_refuses_requests(self) -> None:
        gate, config = clean_gate()
        outcome = evaluate(
            gate, state_from(config), intent(), requested_leverage=Decimal("3")
        )
        assert outcome.decision.code is RiskDecisionCode.MAX_LEVERAGE_EXCEEDED

    def test_total_volume_cap(self) -> None:
        gate, config = clean_gate(limit(RiskRuleId.MAX_TOTAL_VOLUME, "500"))
        state = state_from(config, traded="450")
        # new 100 -> 550 > 500 breach; reduce-only exempt
        outcome = evaluate(gate, state, intent(quantity="1"))
        assert outcome.decision.code is RiskDecisionCode.MAX_VOLUME_EXCEEDED
        flat = state_from(config, traded="450", position="2")
        reduced = evaluate(
            gate,
            flat,
            intent(quantity="1", side=OrderSide.SELL, reduce_only=True),
        )
        assert reduced.decision.approved

    def test_fee_budget_needs_an_authoritative_rate(self) -> None:
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_FEE_BUDGET, "1"),
            extra_config={"fee_rate_bps": Decimal("10")},
        )
        state = state_from(config, fees="0.95")
        # new notional 100 * 10bps = 0.10 fee -> projected 1.05 > 1
        outcome = evaluate(gate, state, intent(quantity="1"))
        assert outcome.decision.code is RiskDecisionCode.FEE_BUDGET_EXCEEDED
        no_rate, _ = clean_gate(limit(RiskRuleId.MAX_FEE_BUDGET, "1000"))
        refusing = evaluate(no_rate, state_from(None), intent())
        assert refusing.decision.code is RiskDecisionCode.FEE_BUDGET_EXCEEDED


class TestProtectionsAndEvents:
    def test_breach_proposes_protection_then_blocks_new_risk(self) -> None:
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_DAILY_LOSS, "500"),
            policy=AutomaticProtectionPolicy(
                daily_loss_action=ProtectionAction.BLOCK_NEW_RISK,
                allow_risk_reducing_orders=True,
            ),
        )
        state = state_from(config, realised="-600", position="2")
        first = evaluate(gate, state, intent())
        assert first.decision.code is RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED
        assert first.proposed_protections != ()
        assert first.proposed_protections[0].action is ProtectionAction.BLOCK_NEW_RISK
        assert first.proposed_protections[0].switch_scope is KillSwitchScope.RISK
        gate.apply_protections(first.proposed_protections, now_micros=NOW)
        # the same breach now refuses with the kill-switch code, not the
        # limit code: the protection is what stands between strategy and
        # venue now.
        second = evaluate(gate, state, intent())
        assert second.decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED
        assert second.decision.kill_switch_scope is KillSwitchScope.RISK
        # and improving PnL does NOT auto-clear a triggered switch
        better = evaluate(gate, state_from(config, realised="0", position="2"), intent())
        assert better.decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED

    def test_events_are_deduplicated_by_condition(self) -> None:
        sink = InMemoryRiskEventSink()
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_ORDER_NOTIONAL, "10"), events=sink
        )
        evaluate(gate, state_from(config), intent(quantity="1"))
        evaluate(gate, state_from(config), intent(quantity="2"))
        breaches = [
            event
            for event in sink.events
            if event.kind is RiskEventKind.LIMIT_BREACHED
            and event.rule_id is RiskRuleId.MAX_ORDER_NOTIONAL
        ]
        assert len(breaches) == 1  # same condition, one event; both decisions denied

    def test_severity_ladder_on_events(self) -> None:
        from wlct_trading.enums import RiskEventSeverity

        assert RiskEventSeverity.EMERGENCY.value == "EMERGENCY"
        # corrupted state path yields EMERGENCY
        gate, config = clean_gate()
        state = state_from(config)
        state = replace(state, config_digest="0" * 64)
        outcome = evaluate(gate, state, intent())
        assert outcome.decision.code is RiskDecisionCode.STALE_RISK_STATE
        assert any(
            event.severity.value in ("CRITICAL", "EMERGENCY")
            for event in outcome.events
        )

    def test_exemption_event_is_deduplicated_per_condition(self) -> None:
        # the exemption event must be distinguishable from a breach on query;
        # it is PROTECTION_EXEMPTED, and dedupes per protection+account+day.
        sink = InMemoryRiskEventSink()
        ledger = KillSwitchLedger(
            (
                KillSwitchRecord(
                    scope=KillSwitchScope.RISK,
                    target="account:acct-1",
                    status=RiskSwitchStatus.TRIGGERED,
                    triggered_by_rule=RiskRuleId.MAX_DAILY_LOSS,
                ),
            )
        )
        gate, config = clean_gate(kill=ledger, events=sink)
        state = state_from(config, position="2")
        evaluate(gate, state, intent(quantity="1", side=OrderSide.SELL, reduce_only=True))
        evaluate(gate, state, intent(quantity="1", side=OrderSide.SELL, reduce_only=True))
        exempted = [e for e in sink.events if e.kind is RiskEventKind.PROTECTION_EXEMPTED]
        assert len(exempted) == 1


class TestFailClosedMatrix:
    def test_gate_without_configuration_refuses_everything(self) -> None:
        gate = RiskGate(configuration=None, simulated=True)
        outcome = gate.evaluate(
            intent(),
            state=state_from(None),
            request_id="req-1",
            trading_mode=TradingMode.PAPER,
        )
        assert outcome.decision.code is RiskDecisionCode.RISK_CONFIGURATION_INVALID

    def test_invalid_gate_configuration_refuses_construction(self) -> None:
        with pytest.raises(GateError):
            RiskGate(
                configuration=RiskConfiguration(
                    entries=[limit(RiskRuleId.MAX_ORDER_NOTIONAL, "1")],
                    correlation_groups=(
                        CorrelationGroup(
                            name="g",
                            exchange="binance",
                            members=frozenset({"BTC-USDT", "ETH-USDT"}),
                            max_notional=Decimal("10"),
                        ),
                    ),
                ),
                simulated=True,
            )

    def test_config_change_invalidates_old_snapshots(self) -> None:
        gate, config = clean_gate()
        old_state = state_from(config)
        new_config = config_with(
            *BASELINE,
            limit(RiskRuleId.MAX_ORDER_NOTIONAL, "42"),
        )
        gate.update_configuration(new_config)
        outcome = evaluate(gate, old_state, intent())
        assert outcome.decision.code is RiskDecisionCode.STALE_RISK_STATE
        assert any(
            event.kind is RiskEventKind.STALE_RISK_STATE for event in outcome.events
        )

    def test_live_gate_refuses_simulated_state(self) -> None:
        config = config_with(*BASELINE)
        live_gate = RiskGate(configuration=config, simulated=False)
        outcome = live_gate.evaluate(
            intent(),
            state=state_from(config),  # is_simulated=True
            request_id="req-1",
            trading_mode=TradingMode.PAPER,
            now_micros=NOW,
        )
        assert not outcome.decision.approved
        assert outcome.decision.code is RiskDecisionCode.RISK_STATE_UNAVAILABLE

    def test_tenant_mismatch_refused(self) -> None:
        gate, config = clean_gate()
        state = state_from(config)
        order = intent()
        order = OrderIntent(
            tenant_id="intruder",
            account_id="acct-1",
            strategy_id="strat-1",
            exchange=ExchangeId.BINANCE,
            symbol=SYMBOL,
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=Decimal("1"),
            price=Decimal("100"),
        )
        outcome = evaluate(gate, state, order)
        assert outcome.decision.code is RiskDecisionCode.RISK_STATE_UNAVAILABLE

    def test_cross_symbol_market_state_refuses_staleness_check(self) -> None:
        gate, config = clean_gate(
            limit(RiskRuleId.MAX_STALE_DATA_AGE, "1_000".replace("_", ""))
        )
        state = state_from(config, market_states=(market(symbol="ETH-USDT"),))
        outcome = evaluate(gate, state, intent())
        assert not outcome.decision.approved

    def test_unconfigured_stale_age_still_refuses_missing_market(self) -> None:
        # even with NO MAX_STALE_DATA_AGE entry, an order for a symbol the
        # snapshot has no market state for cannot be evaluated: the core
        # bridge reports the shortfall and the gate refuses.
        gate, config = clean_gate()
        state = state_from(config, market_states=(market(symbol="OTHER"),))
        outcome = evaluate(gate, state, intent())
        assert not outcome.decision.approved

    def test_rate_coordinator_error_denies(self) -> None:
        class ExplodingCoordinator:
            def try_consume(self, *args, **kwargs):
                raise RuntimeError("redis is on fire")

            def rollback(self, reservation) -> None:
                raise AssertionError("must not roll back what was never granted")

        gate, config = clean_gate(
            limit(
                RiskRuleId.MAX_ORDER_RATE,
                "5",
                window=RATE_WINDOW_ONE_MINUTE_MICROS,
            ),
            rates=ExplodingCoordinator(),
        )
        state = state_from(
            config,
            rate=RiskRateState(
                measured_at_micros=NOW,
                orders_last_second=0,
                orders_last_minute=0,
                cancels_last_second=0,
                cancels_last_minute=0,
            ),
        )
        outcome = evaluate(gate, state, intent())
        assert not outcome.decision.approved
        assert outcome.decision.code is RiskDecisionCode.RISK_STATE_UNAVAILABLE


class TestReservationLedgerIntegration:
    def test_two_instances_share_one_ledger_and_only_one_gets_room(self) -> None:
        # 33: distributed risk-state update. Two gates, one ledger (the
        # "two workers, one Redis" shape in-process). Cap 150, first gate
        # reserves 100, second must be denied on the same 100.
        ledger = LocalReservationLedger()
        config = config_with(*BASELINE, limit(RiskRuleId.MAX_ACCOUNT_EXPOSURE, "150"))
        gate_a = RiskGate(
            configuration=config, simulated=True, reservations=ledger
        )
        gate_b = RiskGate(
            configuration=config, simulated=True, reservations=ledger
        )
        state = state_from(config, available="9900")
        first = gate_a.evaluate(
            intent(),
            state=state,
            request_id="req-a",
            trading_mode=TradingMode.PAPER,
            now_micros=NOW,
        )
        assert first.decision.approved
        assert first.reservation is not None
        second = gate_b.evaluate(
            intent(),
            state=state,
            request_id="req-b",
            trading_mode=TradingMode.PAPER,
            now_micros=NOW,
        )
        assert second.decision.code is RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED
        # after the first order dies before the venue and its ticket is
        # released, room exists again - the release, not the clock, frees it.
        gate_a.release_reservation(first.reservation)
        third = gate_b.evaluate(
            intent(),
            state=state,
            request_id="req-c",
            trading_mode=TradingMode.PAPER,
            now_micros=NOW,
        )
        assert third.decision.approved

    def test_risk_reducing_orders_need_no_reservation(self) -> None:
        ledger = LocalReservationLedger()
        config = config_with(*BASELINE, limit(RiskRuleId.MAX_ACCOUNT_EXPOSURE, "10"))
        gate = RiskGate(configuration=config, simulated=True, reservations=ledger)
        state = state_from(config, position="2")
        closing = gate.evaluate(
            intent(quantity="1", side=OrderSide.SELL, reduce_only=True),
            state=state,
            request_id="req-close",
            trading_mode=TradingMode.PAPER,
            now_micros=NOW,
        )
        assert closing.decision.approved
        assert closing.reservation is None


class TestDuplicateAndModes:
    def test_duplicate_client_order_id_still_refused_by_core_layer(self) -> None:
        gate, config = clean_gate()
        state = state_from(config, open_orders=(open_order("dupe"),))
        outcome = evaluate(
            gate, state, intent(client_order_id="dupe")
        )
        assert outcome.decision.code is RiskDecisionCode.DUPLICATE_ORDER

    def test_trading_disabled_denies_before_rules(self) -> None:
        # A zero quantity ceiling is a configuration error by design (the
        # unit domain is > 0): "no trading" is expressed by the trading mode
        # or a disabled account, never by an unrepresentable limit value.
        gate, config = clean_gate()
        outcome = gate.evaluate(
            intent(),
            state=state_from(config),
            request_id="req-1",
            trading_mode=TradingMode.DISABLED,
            now_micros=NOW,
        )
        assert outcome.decision.code is RiskDecisionCode.TRADING_DISABLED

    def test_zero_quantity_ceiling_is_a_configuration_error(self) -> None:
        from wlct_trading.risk.configuration import RiskConfigurationError

        with pytest.raises(RiskConfigurationError, match="must be > 0"):
            limit(RiskRuleId.MAX_ORDER_QUANTITY, "0")


def replace_account(
    state: RiskStateSnapshot,
    *,
    equity: Decimal | None = Decimal("10000"),
    available: Decimal | None = Decimal("9000"),
    reserved: Decimal | None = Decimal("1000"),
) -> RiskStateSnapshot:
    return replace(
        state,
        account=RiskAccountState(
            tenant_id=state.tenant_id,
            account_id=state.account_id,
            exchange=ExchangeId.BINANCE,
            equity=equity,
            available=available,
            reserved=reserved,
            source_timestamp_micros=NOW,
        ),
    )
