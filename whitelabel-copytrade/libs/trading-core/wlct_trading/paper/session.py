"""Paper trading: real market data, simulated execution.

A paper session runs the production path against a live feed and stops one step
short of the venue. Market data is real, the strategy is the real strategy, the
signal validator and the risk engine are the real ones, and the only substitution
is the execution adapter - a
:class:`~wlct_trading.adapters.paper.PaperTradingAdapter` in place of a
credentialed one.

The safety boundary is enforced in the constructor, not by convention:

* the adapter must report ``is_simulated=True`` or the session refuses to be
  created;
* the trading mode must be ``PAPER``; ``LIVE`` and ``DISABLED`` both raise;
* the session holds no credential, no API key and no signer, and there is no
  constructor argument that could carry one.

Those three checks are what the mandatory paper-trading safety test asserts.
A session that has been constructed cannot reach a live venue, because it has
no object capable of reaching one.

PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE. The simulator ignores
queue position, market impact, venue rejections and latency variance, all of
which cost real money on a real venue.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.adapters.base import TradingAdapter
from wlct_trading.backtest.portfolio import SimulatedPortfolio
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, MarketType, TradingMode
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.market_data import BookTop, Candle, PublicTrade, Ticker
from wlct_trading.metrics import StrategyMetrics
from wlct_trading.orders import Order
from wlct_trading.positions import Position
from wlct_trading.risk import (
    KillSwitchState,
    RiskEngine,
    RiskLimits,
    RiskSnapshot,
    RiskStateSnapshot,
    RiskGate,
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

__all__ = [
    "PaperTradingSafetyError",
    "PaperSessionConfig",
    "PaperSessionSummary",
    "PaperTradingSession",
]

_LOG = logging.getLogger(__name__)
_ZERO = Decimal(0)
_ONE_MINUTE_MICROS = 60_000_000

#: The only mode a paper session may run in. ``LIVE`` is absent deliberately,
#: ``DISABLED`` because a disabled session should not have been started at all,
#: and no code path adds to this set at runtime.
_PERMITTED_MODES = frozenset({TradingMode.PAPER})


class PaperTradingSafetyError(RuntimeError):
    """Raised when a paper session is asked to do something unsafe.

    Always fatal at construction time. A session that could route to a live
    venue must not exist, so this is raised instead of logged.
    """


@dataclass(slots=True, frozen=True)
class PaperSessionConfig:
    """Configuration for one paper session.

    Notice what is *not* here: no API key, no secret, no signer, no endpoint
    override. A paper session has no use for a credential and therefore has no
    field to put one in.
    """

    session_id: str
    tenant_id: str
    account_id: str
    exchange: ExchangeId
    symbol: str
    initial_capital: Decimal
    risk_limits: RiskLimits | None = None
    market_type: MarketType = MarketType.SPOT
    trading_mode: TradingMode = TradingMode.PAPER
    quote_asset: str = "USDT"
    base_asset: str = "BTC"
    engine_config: StrategyEngineConfig | None = None
    #: How often the session records an equity snapshot, in microseconds.
    #: Snapshots are in-memory; persistence is the host's decision and happens
    #: on a schedule, never per tick.
    snapshot_interval_micros: int = 60_000_000

    def __post_init__(self) -> None:
        if not self.session_id:
            raise PaperTradingSafetyError("PaperSessionConfig requires a session_id.")
        if not self.tenant_id:
            raise PaperTradingSafetyError("PaperSessionConfig requires a tenant_id.")
        if not self.account_id:
            raise PaperTradingSafetyError("PaperSessionConfig requires an account_id.")
        if not isinstance(self.initial_capital, Decimal):
            raise PaperTradingSafetyError("initial_capital must be a Decimal.")
        if self.initial_capital <= _ZERO:
            raise PaperTradingSafetyError("initial_capital must be positive.")
        if self.trading_mode not in _PERMITTED_MODES:
            raise PaperTradingSafetyError(
                f"A paper session cannot run in {self.trading_mode.value} mode. "
                "The only permitted mode is PAPER."
            )
        if self.snapshot_interval_micros <= 0:
            raise PaperTradingSafetyError(
                "snapshot_interval_micros must be positive."
            )


@dataclass(slots=True, frozen=True)
class PaperSessionSummary:
    """A durable summary of a session, safe to persist and to display.

    Everything is labelled simulated. This is the object a host writes to
    PostgreSQL when a session ends or on a slow schedule - never per tick.
    """

    session_id: str
    tenant_id: str
    strategy_key: str
    strategy_version: str
    exchange: ExchangeId
    symbol: str
    trading_mode: TradingMode
    started_at_micros: int
    ended_at_micros: int | None
    initial_capital: Decimal
    final_equity: Decimal
    realised_pnl: Decimal
    unrealised_pnl: Decimal | None
    fees_paid: Decimal
    max_drawdown: Decimal
    simulated_orders: int
    simulated_fills: int
    signals_generated: int
    signals_accepted: int
    signals_rejected: int
    risk_rejections: int
    strategy_errors: int
    is_simulated: bool = True

    def to_dict(self) -> dict[str, object]:
        return {
            "sessionId": self.session_id,
            "tenantId": self.tenant_id,
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "tradingMode": self.trading_mode.value,
            "startedAtMicros": self.started_at_micros,
            "endedAtMicros": self.ended_at_micros,
            "initialCapital": str(self.initial_capital),
            "finalEquity": str(self.final_equity),
            "realisedPnl": str(self.realised_pnl),
            "unrealisedPnl": (
                str(self.unrealised_pnl) if self.unrealised_pnl is not None else None
            ),
            "feesPaid": str(self.fees_paid),
            "maxDrawdown": str(self.max_drawdown),
            "simulatedOrders": self.simulated_orders,
            "simulatedFills": self.simulated_fills,
            "signalsGenerated": self.signals_generated,
            "signalsAccepted": self.signals_accepted,
            "signalsRejected": self.signals_rejected,
            "riskRejections": self.risk_rejections,
            "strategyErrors": self.strategy_errors,
            "isSimulated": True,
            "disclaimer": (
                "SIMULATED session. Paper performance is not indicative of live "
                "performance and does not guarantee real execution quality."
            ),
        }


class PaperTradingSession:
    """One strategy trading one symbol on simulated execution, live data."""

    __slots__ = (
        "_config",
        "_adapter",
        "_strategy",
        "_strategy_engine",
        "_risk_engine",
        "_portfolio",
        "_metrics",
        "_book_top",
        "_last_price",
        "_open_orders",
        "_recent_order_times",
        "_started_at",
        "_ended_at",
        "_running",
        "_simulated_orders",
        "_simulated_fills",
        "_signals_generated",
        "_signals_accepted",
        "_signals_rejected",
        "_risk_rejections",
        "_last_snapshot_micros",
        "_snapshots",
        "_risk_gate",
        "_risk_state_version",
        "_protections_triggered",
    )

    def __init__(
        self,
        *,
        config: PaperSessionConfig,
        strategy: Strategy,
        adapter: TradingAdapter,
        risk_engine: RiskEngine | None = None,
        metrics: StrategyMetrics | None = None,
        risk_gate: RiskGate | None = None,
    ) -> None:
        # -- the safety gate. Nothing else in this class may run first. -----
        if not getattr(adapter, "is_simulated", False):
            raise PaperTradingSafetyError(
                "A paper session refuses an execution adapter that is not "
                f"marked simulated (got {type(adapter).__name__}). Paper "
                "trading must never reach a live venue."
            )
        if config.trading_mode not in _PERMITTED_MODES:  # pragma: no cover
            raise PaperTradingSafetyError(
                f"Refusing to start a paper session in {config.trading_mode.value}."
            )
        if strategy.symbol != config.symbol:
            raise PaperTradingSafetyError(
                f"Strategy trades {strategy.symbol}; session is for {config.symbol}."
            )
        if strategy.descriptor.exchange is not config.exchange:
            raise PaperTradingSafetyError(
                f"Strategy is configured for {strategy.descriptor.exchange.value}; "
                f"session is for {config.exchange.value}."
            )

        # Part 8: a wired risk gate must be the SIMULATED instance. A live
        # gate in a paper session would read a paper snapshot and refuse it
        # on the pairing check anyway - refusing at construction says the
        # same thing earlier and with a better message.
        if risk_gate is not None and not risk_gate.is_simulated:
            raise PaperTradingSafetyError(
                "Paper sessions must wire the simulated risk gate "
                "(RiskGate(simulated=True)); a live gate is refused by its "
                "own pairing check and by this one."
            )
        self._risk_gate = risk_gate
        self._risk_state_version = 0
        self._protections_triggered = 0
        self._config = config
        self._adapter = adapter
        self._strategy = strategy
        self._metrics = metrics or StrategyMetrics()
        self._risk_engine = risk_engine or RiskEngine(config.risk_limits or RiskLimits())
        self._portfolio = SimulatedPortfolio(
            initial_cash=config.initial_capital,
            tenant_id=config.tenant_id,
            account_id=config.account_id,
            exchange=config.exchange,
            symbol=config.symbol,
            quote_asset=config.quote_asset,
            base_asset=config.base_asset,
        )
        self._strategy_engine = StrategyEngine(
            config=config.engine_config or StrategyEngineConfig(),
            metrics=self._metrics,
            position_provider=self._provide_position,
            open_orders_provider=self._provide_open_orders,
            risk_view_provider=self._provide_risk_view,
            kill_switch_provider=KillSwitchState,
            freshness_provider=self._provide_freshness,
        )
        self._strategy_engine.add(strategy)

        self._book_top: BookTop | None = None
        self._last_price: Decimal | None = None
        self._open_orders: dict[str, Order] = {}
        self._recent_order_times: list[int] = []
        self._started_at: int | None = None
        self._ended_at: int | None = None
        self._running = False
        self._simulated_orders = 0
        self._simulated_fills = 0
        self._signals_generated = 0
        self._signals_accepted = 0
        self._signals_rejected = 0
        self._risk_rejections = 0
        self._last_snapshot_micros: int | None = None
        self._snapshots: list[dict[str, object]] = []

    # -- identity -------------------------------------------------------------
    @property
    def is_simulated(self) -> bool:
        """Always ``True``. A paper session cannot produce a real fill."""
        return True

    @property
    def session_id(self) -> str:
        return self._config.session_id

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def portfolio(self) -> SimulatedPortfolio:
        return self._portfolio

    @property
    def metrics(self) -> StrategyMetrics:
        return self._metrics

    @property
    def strategy_engine(self) -> StrategyEngine:
        return self._strategy_engine

    @property
    def snapshots(self) -> tuple[dict[str, object], ...]:
        """Equity snapshots taken so far. In memory; persistence is the host's."""
        return tuple(self._snapshots)

    # -- lifecycle ---------------------------------------------------------------
    def start(self, *, now_micros: int | None = None) -> None:
        now = epoch_micros() if now_micros is None else now_micros
        if self._running:
            raise PaperTradingSafetyError(
                f"Paper session {self._config.session_id} is already running."
            )
        self._started_at = now
        self._ended_at = None
        self._running = True
        self._strategy_engine.start_all(now_micros=now)
        self._metrics.counters.paper_sessions_started += 1
        _LOG.info(
            "paper session started session_id=%s tenant_id=%s strategy=%s@%s "
            "symbol=%s mode=%s simulated=True",
            self._config.session_id,
            self._config.tenant_id,
            self._strategy.strategy_key,
            self._strategy.strategy_version,
            self._config.symbol,
            self._config.trading_mode.value,
        )

    def stop(self, *, now_micros: int | None = None) -> PaperSessionSummary:
        now = epoch_micros() if now_micros is None else now_micros
        self._strategy_engine.stop_all(now_micros=now)
        self._running = False
        self._ended_at = now
        self._metrics.counters.paper_sessions_stopped += 1
        summary = self.summary()
        _LOG.info(
            "paper session stopped session_id=%s orders=%d fills=%d "
            "final_equity=%s simulated=True",
            self._config.session_id,
            self._simulated_orders,
            self._simulated_fills,
            summary.final_equity,
        )
        return summary

    # -- providers ----------------------------------------------------------------
    def _provide_position(self, _key: StrategyInstanceKey) -> Position | None:
        return self._portfolio.position

    def _provide_open_orders(self, _key: StrategyInstanceKey) -> tuple[Order, ...]:
        return tuple(self._open_orders.values())

    def _provide_risk_view(self, _key: StrategyInstanceKey) -> StrategyRiskView:
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
        """Real wall-clock freshness. Paper trading uses live data, so a stale
        feed must stop it exactly as it would stop live trading."""
        if self._book_top is None:
            return (False, None)
        age = epoch_micros() - self._book_top.exchange_timestamp
        if age < 0:
            return (False, None)
        return (True, age)

    # -- market data ---------------------------------------------------------------
    async def on_book_top(self, top: BookTop) -> tuple[SignalOutcome, ...]:
        self._require_running()
        self._book_top = top
        mid = top.mid_price
        if mid is not None:
            self._last_price = mid
        outcomes = self._strategy_engine.dispatch_book_top(top)
        await self._handle_outcomes(outcomes)
        self._maybe_snapshot()
        return outcomes

    async def on_ticker(self, ticker: Ticker) -> tuple[SignalOutcome, ...]:
        self._require_running()
        if ticker.last_price is not None:
            self._last_price = ticker.last_price
        outcomes = self._strategy_engine.dispatch_ticker(ticker)
        await self._handle_outcomes(outcomes)
        self._maybe_snapshot()
        return outcomes

    async def on_trade(self, trade: PublicTrade) -> tuple[SignalOutcome, ...]:
        self._require_running()
        self._last_price = trade.price
        outcomes = self._strategy_engine.dispatch_trade(trade)
        await self._handle_outcomes(outcomes)
        self._maybe_snapshot()
        return outcomes

    async def on_candle(self, candle: Candle) -> tuple[SignalOutcome, ...]:
        self._require_running()
        self._last_price = candle.close
        outcomes = self._strategy_engine.dispatch_candle(candle)
        await self._handle_outcomes(outcomes)
        self._maybe_snapshot()
        return outcomes

    def invalidate_market_data(self) -> None:
        """Feed became untrustworthy: drop the book and reset features."""
        self._book_top = None
        self._strategy_engine.invalidate_symbol(self._config.symbol)

    # -- routing ------------------------------------------------------------------
    async def _handle_outcomes(self, outcomes: tuple[SignalOutcome, ...]) -> None:
        for outcome in outcomes:
            self._signals_generated += 1
            if not outcome.accepted:
                self._signals_rejected += 1
                continue
            self._signals_accepted += 1
            await self._route(outcome.signal)

    async def _route(self, signal: Signal) -> None:
        """Signal -> intent -> risk -> simulated adapter.

        The risk engine is not optional and not bypassable: there is exactly
        one call to the adapter in this class and it sits behind the approval
        check below.
        """
        intent = signal_to_intent(
            signal,
            account_id=self._config.account_id,
            current_position_quantity=self._portfolio.base_quantity,
        )
        if intent is None:
            return

        client_order_id = build_client_order_id(intent)
        intent.client_order_id = client_order_id
        now = epoch_micros()

        decision = self._risk_engine.evaluate(
            intent,
            snapshot=self._risk_snapshot(now),
            kill_switches=KillSwitchState(),
            trading_mode=self._config.trading_mode,
            book_top=self._book_top,
            strategy_enabled=True,
        )
        if not decision.approved or not decision.would_route:
            self._risk_rejections += 1
            self._metrics.counters.risk_rejections += 1
            _LOG.info(
                "paper signal rejected by risk session_id=%s signal_id=%s code=%s",
                self._config.session_id,
                signal.signal_id,
                decision.code.value,
            )
            return

        # Part 8: the extended gate, on SIMULATED state only. Paper never
        # reads a live account: every number in this snapshot comes from the
        # session's own portfolio, and the gate instance was validated above
        # to be the simulated one.
        if self._risk_gate is not None:
            self._risk_state_version += 1
            state = self._risk_state_snapshot(now, self._risk_state_version)
            gate_outcome = self._risk_gate.evaluate(
                intent,
                state=state,
                request_id=client_order_id,
                trading_mode=self._config.trading_mode,
                now_micros=now,
                book_top=self._book_top,
            )
            if gate_outcome.proposed_protections:
                self._protections_triggered += len(gate_outcome.proposed_protections)
                self._risk_gate.apply_protections(
                    gate_outcome.proposed_protections, now_micros=now
                )
            if not gate_outcome.decision.approved:
                self._risk_rejections += 1
                self._metrics.counters.risk_rejections += 1
                _LOG.info(
                    "paper signal rejected by risk gate session_id=%s "
                    "signal_id=%s code=%s",
                    self._config.session_id,
                    signal.signal_id,
                    gate_outcome.decision.code.value,
                )
                return

        result = await self._adapter.submit_order(intent, client_order_id)
        self._simulated_orders += 1
        self._metrics.counters.simulated_orders += 1
        self._recent_order_times.append(now)
        self._recent_order_times = [
            timestamp
            for timestamp in self._recent_order_times
            if now - timestamp <= _ONE_MINUTE_MICROS
        ]

        if not result.accepted:
            self._metrics.counters.simulated_orders_rejected += 1
            return
        if not result.is_simulated:
            # Structurally impossible with a simulated adapter, and fatal if it
            # ever happened: a real fill has entered a simulated portfolio.
            raise PaperTradingSafetyError(
                "A paper session received a result that is not marked "
                "simulated. Refusing to continue."
            )

        order = Order.from_intent(
            intent,
            client_order_id=client_order_id,
            order_id=result.exchange_order_id or client_order_id,
            is_simulated=True,
        )
        if not result.fills:
            self._open_orders[client_order_id] = order

        for fill in result.fills:
            self._simulated_fills += 1
            self._metrics.counters.simulated_fills += 1
            self._portfolio.apply_fill(fill)

    def _risk_state_snapshot(self, now_micros: int, version: int) -> RiskStateSnapshot:
        """Simulated Part 8 state, assembled from this session's portfolio.

        Single symbol, single strategy; open simulated orders are mapped to
        their risk view. The paper adapter never places live orders, so the
        reservation and rate machinery operates on fully local numbers - the
        same code paths as production, the same determinism, zero venue
        interaction.
        """
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
                exchange=self._config.exchange,
                symbol=self._config.symbol,
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
                    None
                    if self._risk_gate is None
                    else self._risk_gate.configuration
                ),
                session_note=f"paper-session:{self._config.session_id}",
            )
        )

    def _risk_snapshot(self, now_micros: int) -> RiskSnapshot:
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

    # -- reporting --------------------------------------------------------------------
    def _require_running(self) -> None:
        if not self._running:
            raise PaperTradingSafetyError(
                f"Paper session {self._config.session_id} is not running."
            )

    def _maybe_snapshot(self) -> None:
        now = epoch_micros()
        if (
            self._last_snapshot_micros is None
            or now - self._last_snapshot_micros >= self._config.snapshot_interval_micros
        ):
            point = self._portfolio.mark_to_market(
                timestamp_micros=now, mark_price=self._last_price
            )
            self._snapshots.append(point.to_dict())
            self._last_snapshot_micros = now

    def summary(self) -> PaperSessionSummary:
        """A persistable snapshot of the session so far."""
        instance = self._strategy_engine.instances()[0]
        return PaperSessionSummary(
            session_id=self._config.session_id,
            tenant_id=self._config.tenant_id,
            strategy_key=self._strategy.strategy_key,
            strategy_version=self._strategy.strategy_version,
            exchange=self._config.exchange,
            symbol=self._config.symbol,
            trading_mode=self._config.trading_mode,
            started_at_micros=self._started_at or 0,
            ended_at_micros=self._ended_at,
            initial_capital=self._config.initial_capital,
            final_equity=self._portfolio.equity(self._last_price),
            realised_pnl=self._portfolio.realised_pnl,
            unrealised_pnl=self._portfolio.unrealised_pnl,
            fees_paid=self._portfolio.fees_paid,
            max_drawdown=self._portfolio.max_drawdown,
            simulated_orders=self._simulated_orders,
            simulated_fills=self._simulated_fills,
            signals_generated=self._signals_generated,
            signals_accepted=self._signals_accepted,
            signals_rejected=self._signals_rejected,
            risk_rejections=self._risk_rejections,
            strategy_errors=instance.error_count,
        )
