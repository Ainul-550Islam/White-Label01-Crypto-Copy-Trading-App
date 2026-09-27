"""The backtest engine: replay, strategy, risk, simulation, portfolio.

This is the component that wires the Part 6 pieces into one deterministic run.
It reproduces the *production* path exactly - the same strategy engine, the
same signal validator, the same risk engine, the same position manager - and
substitutes only two things: a
:class:`~wlct_trading.backtest.replay.ReplayEngine` in place of the live feed,
and a :class:`~wlct_trading.backtest.simulator.SimulatedMatchingEngine` in
place of the venue.

Two boundaries are structural rather than advisory:

* **No live adapter exists here.** This module imports no adapter, holds no
  credential, opens no socket and has no configuration field that could point
  at one. A backtest cannot send an order because there is nothing to send it
  to.
* **The risk engine is not bypassed.** Every signal that passes validation is
  converted to an intent and put through :class:`~wlct_trading.risk.RiskEngine`
  before it can reach the simulator, in ``TradingMode.PAPER``. A rejected
  intent is counted and dropped. There is no branch that submits an unapproved
  intent.

Determinism is maintained by never consulting a wall clock, a random number
generator or a UUID on the result path. Timestamps come from the simulated
clock; ids come from a counter. Running the same dataset with the same
configuration twice produces two results whose
:meth:`~wlct_trading.backtest.result.BacktestResult.matches` comparison is
true, trade for trade and equity point for equity point.

BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE. Simulation does
not guarantee real execution quality.
"""

from __future__ import annotations

import hashlib
import logging
from collections import Counter, deque
from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.backtest.clock import SimulatedClock
from wlct_trading.backtest.dataset import HistoricalDataset, MarketEvent
from wlct_trading.backtest.metrics import compute_performance
from wlct_trading.backtest.portfolio import SimulatedPortfolio
from wlct_trading.backtest.replay import ReplayCursor, ReplayEngine
from wlct_trading.backtest.result import (
    BacktestResult,
    compute_configuration_hash,
    parameters_to_canonical,
)
from wlct_trading.backtest.simulator import (
    ExecutionAssumptions,
    SimulatedIdFactory,
    SimulatedMatchingEngine,
)
from wlct_trading.clock import monotonic_nanos
from wlct_trading.enums import (
    BacktestPhase,
    TradingMode,
)
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.market_data import BookTop, Candle, OrderBookDelta, OrderBookSnapshot, PublicTrade, Ticker
from wlct_trading.observability.tracing import SpanStatus, Tracer
from wlct_trading.order_book import OrderBook
from wlct_trading.orders import Order
from wlct_trading.positions import Position
from wlct_trading.risk import (
    KillSwitchState,
    RiskEngine,
    RiskGate,
    RiskLimits,
    RiskSnapshot,
    RiskStateSnapshot,
)
from wlct_trading.risk.simulated import (
    SimulatedRiskInputs,
    build_simulated_state,
)
from wlct_trading.risk.snapshot import RiskOpenOrderState
from wlct_trading.signals import Signal, signal_to_intent
from wlct_trading.strategies.base import Strategy
from wlct_trading.strategies.context import StrategyRiskView
from wlct_trading.strategies.lifecycle import (
    SignalOutcome,
    StrategyEngine,
    StrategyEngineConfig,
)
from wlct_trading.strategies.state import StrategyInstanceKey
from wlct_trading.strategies.validation import SignalValidationConfig

__all__ = ["BacktestConfig", "BacktestEngine"]

_LOG = logging.getLogger(__name__)
_ZERO = Decimal(0)
_ONE_MINUTE_MICROS = 60_000_000


@dataclass(slots=True, frozen=True)
class BacktestConfig:
    """Everything that defines a run other than the strategy and the data.

    ``risk_limits`` is required in effect: the risk engine fails closed when no
    layer expresses a limit, so a config without one produces a run in which
    every order is rejected. That is the correct default - a backtest that
    quietly ran without limits would not resemble production.
    """

    tenant_id: str
    account_id: str
    initial_capital: Decimal
    assumptions: ExecutionAssumptions = field(default_factory=ExecutionAssumptions)
    risk_limits: RiskLimits | None = None
    phase: BacktestPhase = BacktestPhase.TEST
    quote_asset: str = "USDT"
    base_asset: str = "BTC"
    #: Fires ``on_timer`` at fixed simulated intervals. ``None`` disables it.
    timer_interval_micros: int | None = None
    #: Equity is recorded on every event by default. Setting a positive value
    #: records at most one point per interval, which keeps the curve bounded on
    #: very long datasets at the cost of resolution.
    mark_interval_micros: int | None = None
    #: Passed to the Sharpe/Sortino calculation. ``None`` leaves the ratios
    #: unannualised, which is the honest default when the observation interval
    #: is "per market event" rather than a calendar period.
    periods_per_year: int | None = None
    validation: SignalValidationConfig | None = None
    engine_config: StrategyEngineConfig | None = None
    run_label: str = ""

    def __post_init__(self) -> None:
        if not self.tenant_id:
            raise ValueError("BacktestConfig requires a tenant_id.")
        if not self.account_id:
            raise ValueError("BacktestConfig requires an account_id.")
        if not isinstance(self.initial_capital, Decimal):
            raise TypeError("BacktestConfig.initial_capital must be a Decimal.")
        if self.initial_capital <= _ZERO:
            raise ValueError("BacktestConfig.initial_capital must be positive.")
        if self.timer_interval_micros is not None and self.timer_interval_micros <= 0:
            raise ValueError("timer_interval_micros must be positive when set.")
        if self.mark_interval_micros is not None and self.mark_interval_micros <= 0:
            raise ValueError("mark_interval_micros must be positive when set.")
        if self.periods_per_year is not None and self.periods_per_year <= 0:
            raise ValueError("periods_per_year must be positive when set.")


class BacktestEngine:
    """Runs one strategy over one dataset and produces one result."""

    __slots__ = (
        "_tracer",
        "_strategy",
        "_dataset",
        "_config",
        "_clock",
        "_replay",
        "_portfolio",
        "_simulator",
        "_strategy_engine",
        "_risk_engine",
        "_book",
        "_book_top",
        "_last_price",
        "_order_sequence",
        "_recent_order_times",
        "_open_orders",
        "_rejections",
        "_signals_generated",
        "_signals_accepted",
        "_signals_rejected",
        "_risk_rejections",
        "_simulated_orders",
        "_simulated_fills",
        "_last_mark_micros",
        "_has_run",
        "_risk_gate",
        "_risk_state_version",
    )

    def __init__(
        self,
        *,
        strategy: Strategy,
        dataset: HistoricalDataset,
        config: BacktestConfig,
        risk_engine: RiskEngine | None = None,
        risk_gate: RiskGate | None = None,
        tracer: Tracer | None = None,
    ) -> None:
        if strategy.symbol != dataset.symbol:
            raise ValueError(
                f"Strategy trades {strategy.symbol} but the dataset covers "
                f"{dataset.symbol}."
            )
        if strategy.descriptor.exchange is not dataset.exchange:
            raise ValueError(
                f"Strategy is configured for "
                f"{strategy.descriptor.exchange.value} but the dataset is from "
                f"{dataset.exchange.value}."
            )

        self._strategy = strategy
        self._dataset = dataset
        self._config = config

        start = dataset.descriptor.start_micros
        self._clock = SimulatedClock(start_micros=start)
        self._replay = ReplayEngine(
            dataset,
            clock=self._clock,
            timer_interval_micros=config.timer_interval_micros,
        )

        self._portfolio = SimulatedPortfolio(
            initial_cash=config.initial_capital,
            tenant_id=config.tenant_id,
            account_id=config.account_id,
            exchange=dataset.exchange,
            symbol=dataset.symbol,
            quote_asset=config.quote_asset,
            base_asset=config.base_asset,
        )
        self._simulator = SimulatedMatchingEngine(
            config.assumptions,
            id_factory=SimulatedIdFactory(prefix="sim", deterministic=True),
            exchange=dataset.exchange,
        )
        if risk_gate is not None and not risk_gate.is_simulated:
            raise ValueError(
                "A backtest must wire the simulated risk gate. A live gate "
                "refuses simulated snapshots on its pairing check anyway; "
                "refusing here names the actual mistake (the wiring) instead "
                "of the downstream symptom (every order denied)."
            )
        self._risk_gate = risk_gate
        self._tracer = tracer
        self._risk_state_version = 0
        self._risk_engine = risk_engine or RiskEngine(config.risk_limits or RiskLimits())

        engine_config = config.engine_config or StrategyEngineConfig(
            validation=config.validation or SignalValidationConfig(),
        )
        self._strategy_engine = StrategyEngine(
            config=engine_config,
            position_provider=self._provide_position,
            open_orders_provider=self._provide_open_orders,
            risk_view_provider=self._provide_risk_view,
            kill_switch_provider=KillSwitchState,
            freshness_provider=self._provide_freshness,
        )
        self._strategy_engine.add(strategy)

        self._book = OrderBook(dataset.exchange, dataset.symbol)
        self._book_top: BookTop | None = None
        self._last_price: Decimal | None = None
        self._order_sequence = 0
        self._recent_order_times: deque[int] = deque()
        self._open_orders: dict[str, Order] = {}
        self._rejections: Counter[str] = Counter()
        self._signals_generated = 0
        self._signals_accepted = 0
        self._signals_rejected = 0
        self._risk_rejections = 0
        self._simulated_orders = 0
        self._simulated_fills = 0
        self._last_mark_micros: int | None = None
        self._has_run = False

    # -- inspection -----------------------------------------------------------
    @property
    def portfolio(self) -> SimulatedPortfolio:
        return self._portfolio

    @property
    def clock(self) -> SimulatedClock:
        return self._clock

    @property
    def strategy_engine(self) -> StrategyEngine:
        return self._strategy_engine

    @property
    def simulator(self) -> SimulatedMatchingEngine:
        return self._simulator

    @property
    def is_simulated(self) -> bool:
        """Always ``True``. There is no live path through this class."""
        return True

    # -- providers for the strategy engine -------------------------------------
    def _provide_position(self, _key: StrategyInstanceKey) -> Position | None:
        return self._portfolio.position

    def _provide_open_orders(self, _key: StrategyInstanceKey) -> tuple[Order, ...]:
        return tuple(self._open_orders.values())

    def _provide_risk_view(self, _key: StrategyInstanceKey) -> StrategyRiskView:
        """Read-only risk view. Never authorises anything.

        Marked available because in a backtest the exposure state is known
        exactly - it is held in this process. The live host passes
        ``is_available=False`` when Redis cannot be read, and the validator then
        refuses every actionable signal.
        """
        limits = self._config.risk_limits or RiskLimits()
        quantity = self._portfolio.base_quantity
        mark = self._last_price or _ZERO
        return StrategyRiskView(
            is_available=True,
            max_position_quantity=limits.max_position_quantity,
            max_order_quantity=limits.max_order_quantity,
            current_position_quantity=quantity,
            symbol_exposure_notional=abs(quantity) * mark,
            account_exposure_notional=abs(quantity) * mark,
            open_order_count=len(self._open_orders),
            realised_pnl_today=self._portfolio.realised_pnl,
        )

    def _provide_freshness(self, _key: StrategyInstanceKey) -> tuple[bool, int | None]:
        """Market data age in simulated time.

        Historical data is by definition not fresh in wall-clock terms, so the
        age is computed against the replay clock. Reporting the true wall-clock
        age would make the validator reject every signal and the backtest would
        produce nothing.
        """
        if self._book_top is None:
            return (False, None)
        age = self._clock.now_micros() - self._book_top.exchange_timestamp
        return (age >= 0, max(age, 0))

    # -- the run ---------------------------------------------------------------
    def run(self) -> BacktestResult:
        """Replay the dataset once, optionally observed as a
        ``backtest.run`` span.

        The tracer never enters the matching or risk path: it wraps the run
        from the outside, so a recorded backtest and an unrecorded one are
        the same computation (decision-equivalence applies to backtests and
        paper sessions too, not only to live execution).
        """
        tracer = self._tracer
        if tracer is None:
            return self._run_inner()
        span = tracer.start_span(
            "backtest.run",
            attributes={
                "backtest.symbol": self._dataset.symbol,
                "backtest.tenant_id": self._config.tenant_id,
                "backtest.account_id": self._config.account_id,
                "backtest.simulated": "true",
            },
        )
        try:
            result = self._run_inner()
        except Exception as exc:
            span.record_exception(exc)
            span.set_attribute("outcome", "error")
            span.set_status(SpanStatus.ERROR, description="backtest run failed")
            raise
        span.set_attribute("outcome", "completed")
        span.set_status(SpanStatus.OK)
        span.end()
        return result

    def _run_inner(self) -> BacktestResult:
        """Replay the dataset once and produce a result.

        A single engine runs once. Re-running would compound state onto an
        already-traded portfolio, which is a mistake rather than a feature; a
        second run means a second engine.
        """
        if self._has_run:
            raise RuntimeError(
                "This BacktestEngine has already run. Construct a new one for a "
                "second run so that state cannot leak between them."
            )
        self._has_run = True

        wall_started = monotonic_nanos()
        start_micros = self._dataset.descriptor.start_micros
        self._strategy_engine.start_all(now_micros=start_micros)

        stats = self._replay.run(
            on_event=self._on_event,
            on_timer=self._on_timer if self._config.timer_interval_micros else None,
        )

        end_micros = self._clock.now_micros()
        # Final mark so the equity curve ends at the last observed price rather
        # than at whatever the last recorded point happened to be.
        self._portfolio.mark_to_market(
            timestamp_micros=end_micros, mark_price=self._last_price
        )
        self._strategy_engine.stop_all(now_micros=end_micros)

        wall_elapsed_micros = (monotonic_nanos() - wall_started) // 1_000
        return self._build_result(
            events_replayed=stats.events_replayed,
            wall_clock_duration_micros=wall_elapsed_micros,
        )

    # -- event handling ---------------------------------------------------------
    def _on_timer(self, now_micros: int) -> None:
        for outcome in self._strategy_engine.dispatch_timer(now_micros):
            self._handle_outcome(outcome, now_micros)

    def _on_event(self, event: MarketEvent, cursor: ReplayCursor) -> None:
        now = self._clock.now_micros()
        # Guards against a future read even if a dataset were mis-sorted.
        cursor.assert_not_future(event.timestamp_micros)

        payload = event.payload
        outcomes: tuple[SignalOutcome, ...] = ()

        if isinstance(payload, OrderBookSnapshot):
            self._book.apply_snapshot(payload)
            self._refresh_book(now)
            if self._book_top is not None:
                outcomes = self._strategy_engine.dispatch_book_top(self._book_top)
        elif isinstance(payload, OrderBookDelta):
            result = self._book.apply_delta(payload)
            if not result.applied:
                # A gap in historical data is not something to trade through.
                self._strategy_engine.invalidate_symbol(self._dataset.symbol)
                self._book_top = None
                return
            self._refresh_book(now)
            if self._book_top is not None:
                outcomes = self._strategy_engine.dispatch_book_top(self._book_top)
        elif isinstance(payload, Ticker):
            if payload.last_price is not None:
                self._last_price = payload.last_price
            outcomes = self._strategy_engine.dispatch_ticker(payload)
        elif isinstance(payload, PublicTrade):
            self._last_price = payload.price
            outcomes = self._strategy_engine.dispatch_trade(payload)
        elif isinstance(payload, Candle):
            self._last_price = payload.close
            outcomes = self._strategy_engine.dispatch_candle(payload)

        for outcome in outcomes:
            self._handle_outcome(outcome, now)

        self._maybe_mark(now)

    def _refresh_book(self, now_micros: int) -> None:
        """Publish the new top of book and match resting orders against it."""
        if not self._book.is_usable:
            self._book_top = None
            return
        top = self._book.top()
        self._book_top = top
        mid = top.mid_price
        if mid is not None:
            self._last_price = mid

        for fill_event in self._simulator.on_book_update(top, now_micros=now_micros):
            self._simulated_fills += 1
            self._strategy_engine.metrics.counters.simulated_fills += 1
            self._portfolio.apply_fill(
                fill_event.fill, slippage_cost=fill_event.slippage_cost
            )
            if fill_event.status.name == "FILLED":
                self._open_orders.pop(fill_event.client_order_id, None)

    def _maybe_mark(self, now_micros: int) -> None:
        interval = self._config.mark_interval_micros
        if interval is None:
            self._portfolio.mark_to_market(
                timestamp_micros=now_micros, mark_price=self._last_price
            )
            self._last_mark_micros = now_micros
            return
        if (
            self._last_mark_micros is None
            or now_micros - self._last_mark_micros >= interval
        ):
            self._portfolio.mark_to_market(
                timestamp_micros=now_micros, mark_price=self._last_price
            )
            self._last_mark_micros = now_micros

    # -- signal handling ---------------------------------------------------------
    def _handle_outcome(self, outcome: SignalOutcome, now_micros: int) -> None:
        self._signals_generated += 1
        if not outcome.accepted:
            self._signals_rejected += 1
            self._rejections[outcome.rejection_code.value] += 1
            return
        self._signals_accepted += 1
        self._route(outcome.signal, now_micros)

    def _route(self, signal: Signal, now_micros: int) -> None:
        """Signal -> intent -> risk -> simulator. No step is skippable."""
        intent = signal_to_intent(
            signal,
            account_id=self._config.account_id,
            current_position_quantity=self._portfolio.base_quantity,
        )
        if intent is None:
            return

        # Deterministic idempotency key: the client order id is derived from
        # the intent's fields including created_at, so it must come from the
        # simulated clock rather than the wall clock.
        intent.created_at = now_micros
        client_order_id = build_client_order_id(intent)
        intent.client_order_id = client_order_id

        decision = self._risk_engine.evaluate(
            intent,
            snapshot=self._risk_snapshot(now_micros),
            kill_switches=KillSwitchState(),
            # PAPER, always. A backtest has no live mode to select.
            trading_mode=TradingMode.PAPER,
            book_top=self._book_top,
            strategy_enabled=True,
        )
        if not decision.approved or not decision.would_route:
            self._risk_rejections += 1
            self._strategy_engine.metrics.counters.risk_rejections += 1
            self._rejections[f"RISK_{decision.code.value}"] += 1
            return

        # Part 8: extended gate evaluation on SIMULATED state only. The
        # account figures come from this run's portfolio, the market view from
        # the replayed book - never a live balance, never live Redis. A
        # backtest that read production risk state would not be a backtest;
        # it would be a second opinion from the wrong world.
        if self._risk_gate is not None:
            self._risk_state_version += 1
            state = self._risk_state(now_micros, self._risk_state_version)
            gate_outcome = self._risk_gate.evaluate(
                intent,
                state=state,
                request_id=client_order_id,
                trading_mode=TradingMode.PAPER,
                now_micros=now_micros,
                book_top=self._book_top,
            )
            if gate_outcome.proposed_protections:
                self._risk_gate.apply_protections(
                    gate_outcome.proposed_protections, now_micros=now_micros
                )
            if not gate_outcome.decision.approved:
                self._risk_rejections += 1
                self._strategy_engine.metrics.counters.risk_rejections += 1
                self._rejections[f"GATE_{gate_outcome.decision.code.value}"] += 1
                return

        self._order_sequence += 1
        order_id = f"sim-order-{self._order_sequence:012d}"
        match = self._simulator.submit(
            intent,
            client_order_id=client_order_id,
            order_id=order_id,
            book=self._book_top,
            now_micros=now_micros,
        )
        self._simulated_orders += 1
        self._strategy_engine.metrics.counters.simulated_orders += 1
        self._recent_order_times.append(now_micros)

        if not match.accepted:
            self._strategy_engine.metrics.counters.simulated_orders_rejected += 1
            self._rejections[f"SIMULATOR_{match.reason or 'REJECTED'}"] += 1
            return

        order = Order.from_intent(
            intent,
            client_order_id=client_order_id,
            order_id=order_id,
            is_simulated=True,
        )
        if match.rests:
            self._open_orders[client_order_id] = order

        for fill in match.fills:
            self._simulated_fills += 1
            self._strategy_engine.metrics.counters.simulated_fills += 1
            self._portfolio.apply_fill(fill, slippage_cost=match.slippage_cost)

    def _risk_state(self, now_micros: int, version: int) -> RiskStateSnapshot:
        """Simulated Part 8 state for one candidate order evaluation."""
        position = self._portfolio.position
        open_orders: tuple[RiskOpenOrderState, ...] = tuple(
            RiskOpenOrderState(
                client_order_id=order.client_order_id,
                exchange=order.exchange,
                symbol=order.symbol,
                side=order.side,
                order_type=order.order_type,
                status=order.status,
                quantity=order.quantity,
                filled_quantity=order.filled_quantity,
                is_reduce_only=order.reduce_only,
                time_in_force=order.time_in_force,
                strategy_id=order.strategy_id,
                limit_price=order.price,
                source_timestamp_micros=now_micros,
            )
            for order in sorted(
                self._open_orders.values(), key=lambda o: o.client_order_id
            )
        )
        return build_simulated_state(
            SimulatedRiskInputs(
                tenant_id=self._config.tenant_id,
                account_id=self._config.account_id,
                exchange=self._dataset.exchange,
                symbol=self._dataset.symbol,
                strategy_id=self._strategy.descriptor.strategy_id,
                now_micros=now_micros,
                version=version,
                position_quantity=self._portfolio.base_quantity,
                average_entry_price=(
                    position.average_entry_price if position is not None else None
                ),
                mark_price=position.mark_price if position is not None else None,
                equity=self._portfolio.equity(self._last_price),
                available_cash=self._portfolio.available_cash,
                realised_pnl_today=self._portfolio.realised_pnl,
                unrealised_pnl_today=self._portfolio.unrealised_pnl,
                fees_today=self._portfolio.fees_paid,
                traded_notional_today=self._portfolio.turnover,
                open_orders=open_orders,
                book_top=self._book_top,
                orders_in_last_minute=len(self._recent_order_times),
                configuration=(
                    None if self._risk_gate is None else self._risk_gate.configuration
                ),
                session_note="backtest-engine",
            )
        )

    def _risk_snapshot(self, now_micros: int) -> RiskSnapshot:
        """Exposure state assembled from the simulated portfolio.

        In production this comes from Redis hot state; here it is exact,
        because the only positions that exist are the ones this engine created.
        """
        while (
            self._recent_order_times
            and now_micros - self._recent_order_times[0] > _ONE_MINUTE_MICROS
        ):
            self._recent_order_times.popleft()

        quantity = self._portfolio.base_quantity
        reference = self._last_price
        exposure = abs(quantity) * (reference or _ZERO)
        age: int | None = None
        if self._book_top is not None:
            age = max(now_micros - self._book_top.exchange_timestamp, 0)

        return RiskSnapshot(
            position_quantity=quantity,
            symbol_exposure_notional=exposure,
            account_exposure_notional=exposure,
            open_order_count=len(self._open_orders),
            orders_in_last_minute=len(self._recent_order_times),
            realised_pnl_today=self._portfolio.realised_pnl,
            strategy_realised_pnl_today=self._portfolio.realised_pnl,
            reference_price=reference,
            market_data_age_micros=age,
            book_usable=self._book_top is not None,
            is_complete=True,
        )

    # -- result assembly ------------------------------------------------------------
    def _build_result(
        self, *, events_replayed: int, wall_clock_duration_micros: int
    ) -> BacktestResult:
        parameters = parameters_to_canonical(self._strategy.parameters)
        configuration_hash = compute_configuration_hash(
            strategy_key=self._strategy.strategy_key,
            strategy_version=self._strategy.strategy_version,
            implementation_id=type(self._strategy).implementation_id(),
            parameters=parameters,
            assumptions=self._config.assumptions,
            dataset=self._dataset.descriptor,
            initial_capital=self._config.initial_capital,
        )
        run_id = self._derive_run_id(configuration_hash)

        metrics = compute_performance(
            initial_capital=self._config.initial_capital,
            final_equity=self._portfolio.final_equity,
            realised_pnl=self._portfolio.realised_pnl,
            unrealised_pnl=self._portfolio.unrealised_pnl,
            fees=self._portfolio.fees_paid,
            slippage_cost=self._portfolio.slippage_cost,
            turnover=self._portfolio.turnover,
            closed_trades=self._portfolio.closed_trades,
            equity_curve=self._portfolio.equity_curve,
            exposure_fraction=self._portfolio.exposure_fraction,
            periods_per_year=self._config.periods_per_year,
        )

        instance = self._strategy_engine.instances()[0]
        counters = self._strategy_engine.metrics.counters

        result = BacktestResult(
            run_id=run_id,
            strategy_key=self._strategy.strategy_key,
            strategy_version=self._strategy.strategy_version,
            implementation_id=type(self._strategy).implementation_id(),
            tenant_id=self._config.tenant_id,
            exchange=self._dataset.exchange,
            symbol=self._dataset.symbol,
            phase=self._config.phase,
            started_at_micros=self._dataset.descriptor.start_micros,
            ended_at_micros=self._clock.now_micros(),
            initial_capital=self._config.initial_capital,
            configuration_hash=configuration_hash,
            parameters=parameters,
            assumptions=self._config.assumptions,
            dataset=self._dataset.descriptor,
            metrics=metrics,
            closed_trades=self._portfolio.closed_trades,
            equity_curve=self._portfolio.equity_curve,
            signals_generated=self._signals_generated,
            signals_accepted=self._signals_accepted,
            signals_rejected=self._signals_rejected,
            risk_rejections=self._risk_rejections,
            simulated_orders=self._simulated_orders,
            simulated_fills=self._simulated_fills,
            events_replayed=events_replayed,
            strategy_errors=instance.error_count,
            wall_clock_duration_micros=wall_clock_duration_micros,
            rejection_counts=tuple(sorted(self._rejections.items())),
        )
        counters.backtests_completed += 1
        counters.replay_events += events_replayed
        _LOG.info(
            "backtest complete run_id=%s strategy=%s@%s symbol=%s events=%d "
            "orders=%d fills=%d simulated=True",
            run_id,
            self._strategy.strategy_key,
            self._strategy.strategy_version,
            self._dataset.symbol,
            events_replayed,
            self._simulated_orders,
            self._simulated_fills,
        )
        return result

    def _derive_run_id(self, configuration_hash: str) -> str:
        """Deterministic run id.

        Derived from the configuration hash and an optional label rather than
        from a UUID, so that re-running an identical experiment produces an
        identical id and the two results can be compared directly.
        """
        digest = hashlib.sha256()
        digest.update(configuration_hash.encode("utf-8"))
        digest.update(b"|")
        digest.update(self._config.run_label.encode("utf-8"))
        return f"bt-{digest.hexdigest()[:24]}"
