"""``RiskReplay`` - deterministic reconstruction of risk state from history.

What this is: an audit tool. Given the ordered history of one account -
submits, fills, cancels, market updates, configuration changes - it rebuilds
the snapshot the gate would have held at each step, runs the gate over it,
and reports whether the recorded decisions reproduce. When an incident
review asks "would today's engine have approved the order that cost us
yesterday," this answers with the same code, not a re-telling of it.

What this is emphatically not: a second trading engine. It has no adapter,
no store, no network, and no code path from a decision to anything that
could reach a venue. The import-guard test greps this module's source as
well as the package's, because "it's only for audit" is a comment, and
comments rot.

Determinism contract:

* events are applied in ``(timestamp, sequence, kind, identity)`` order - a
  total order over any input set, so two runs over the same history never
  interleave differently;
* the clock is the replay clock: every stage receives the step's timestamp,
  never wall time, so a replay of March evaluates freshness as of March;
* simulated state only: the replay builds snapshots with ``is_simulated``
  true and evaluates with simulated gates, and the pairing check inside the
  gate is what makes "replay of live state under a live gate" impossible
  rather than discouraged;
* fills are applied through :class:`PositionManager` - the same authority
  the live path uses - so replay verifies the books instead of restating
  them, and a fill id seen twice is applied once;
* every replay reports digests (final state, decision sequence, event
  sequence). A reproduction that does not match the archived digests found
  something real - a changed rule, changed data, a changed engine - and the
  tool's job is to surface that, never to absorb it.

Configuration changes flow *through* the replay, not around it: a
``CONFIG_CHANGE`` step swaps the gate's document, and every later decision
binds to the new digest - which is what lets an audit replay show exactly
which limits were live when an order was approved.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, replace
from decimal import Decimal
from enum import Enum
from typing import Iterable, Mapping

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderBookHealth,
    OrderStatus,
    RiskDecisionCode,
    TradingMode,
)
from wlct_trading.orders import Fill, OrderIntent
from wlct_trading.positions import PositionManager
from wlct_trading.risk.configuration import RiskConfiguration
from wlct_trading.risk.events import RiskEvent, events_for_replay_digest
from wlct_trading.risk.evaluator import GateOutcome, RiskGate
from wlct_trading.risk.freshness import trading_day_utc
from wlct_trading.risk.rate_limits import LocalRateCoordinator
from wlct_trading.risk.snapshot import (
    RiskAccountState,
    RiskMarketDataState,
    RiskOpenOrderState,
    RiskPositionState,
    RiskStateSnapshot,
    RiskStrategyState,
)

__all__ = [
    "ReplayStepKind",
    "ReplayStep",
    "ReplayDecision",
    "RiskReplayResult",
    "RiskReplay",
]


class ReplayStepKind(str, Enum):
    """The five things a risk replay can observe. There is no sixth."""

    ORDER_SUBMIT = "ORDER_SUBMIT"
    FILL = "FILL"
    ORDER_CANCEL = "ORDER_CANCEL"
    MARKET_UPDATE = "MARKET_UPDATE"
    CONFIG_CHANGE = "CONFIG_CHANGE"


@dataclass(slots=True, frozen=True)
class ReplayStep:
    """One input event. ``sequence`` is the caller's tiebreak authority.

    The step carries no decision and no verdict - those are outputs. If the
    history being replayed contains recorded decisions, the caller compares
    the replayed ones to them; feeding recorded verdicts back in would let a
    corrupt archive vouch for itself.
    """

    kind: ReplayStepKind
    timestamp_micros: int
    sequence: int
    #: Identity used for stable ordering and for dedupe (a fill id seen
    # twice is applied once - the same discipline the OMS applies).
    identity: str
    symbol: str | None = None
    exchange: ExchangeId = ExchangeId.BINANCE
    intent: OrderIntent | None = None
    fill: Fill | None = None
    #: For ORDER_CANCEL: the client_order_id being retired.
    cancelled_client_order_id: str | None = None
    #: For MARKET_UPDATE.
    best_bid: Decimal | None = None
    best_ask: Decimal | None = None
    last_trade_price: Decimal | None = None
    #: For CONFIG_CHANGE: the new document.
    configuration: RiskConfiguration | None = None
    #: Records which kind of production history is being replayed. A replay
    # of live history still runs against simulated *replay state* (see the
    # module docstring); this flag only marks the source.
    was_live_history: bool = False

    def order_key(self) -> tuple[int, int, str, str, str]:
        return (
            self.timestamp_micros,
            self.sequence,
            self.kind.value,
            self.identity,
            self.cancelled_client_order_id or "",
        )


@dataclass(slots=True, frozen=True)
class ReplayDecision:
    """The replayed verdict for one submitted order."""

    step_sequence: int
    timestamp_micros: int
    decision_id: str
    code: RiskDecisionCode
    approved: bool
    snapshot_version: int
    rule_outcomes: tuple[tuple[str, str], ...]

    def to_payload(self) -> dict[str, object]:
        return {
            "stepSequence": self.step_sequence,
            "timestampMicros": self.timestamp_micros,
            "decisionId": self.decision_id,
            "code": self.code.value,
            "approved": self.approved,
            "snapshotVersion": self.snapshot_version,
            "ruleOutcomes": [list(item) for item in self.rule_outcomes],
        }


@dataclass(slots=True, frozen=True)
class RiskReplayResult:
    """Everything a replay produces, with the digests to diff by."""

    steps_replayed: int
    decisions: tuple[ReplayDecision, ...]
    events: tuple[RiskEvent, ...]
    final_positions: tuple[tuple[str, Decimal], ...]
    state_digest: str
    decision_digest: str
    event_digest: str
    #: Always true for a replay; the field exists so a serialized result
    # cannot be mistaken for a live engine log by anything downstream that
    # only reads the payload.
    is_simulated: bool = True

    def to_payload(self) -> dict[str, object]:
        return {
            "stepsReplayed": self.steps_replayed,
            "decisions": [decision.to_payload() for decision in self.decisions],
            "events": [event.to_payload() for event in self.events],
            "finalPositions": [
                [symbol, str(quantity)] for symbol, quantity in self.final_positions
            ],
            "stateDigest": self.state_digest,
            "decisionDigest": self.decision_digest,
            "eventDigest": self.event_digest,
            "isSimulated": self.is_simulated,
        }


class RiskReplay:
    """The replay machine: feed steps, get a reproducible verdict history.

    Construction takes the starting configuration and account identity;
    every run is fresh (no state leaks between ``run`` calls), because the
    most common way to make an audit tool lie about history is to make it
    reuse yesterday's in-memory world.
    """

    __slots__ = ("_tenant_id", "_account_id", "_initial_configuration")

    def __init__(
        self,
        *,
        tenant_id: str,
        account_id: str,
        initial_configuration: RiskConfiguration | None,
    ) -> None:
        self._tenant_id = tenant_id
        self._account_id = account_id
        self._initial_configuration = initial_configuration

    # -- public API ------------------------------------------------------------
    def run(
        self,
        steps: Iterable[ReplayStep],
        *,
        starting_equity: Decimal,
        starting_available: Decimal | None = None,
        quote_asset: str = "USDT",
    ) -> RiskReplayResult:
        """Replay ``steps`` in total order and produce the audit result.

        ``starting_equity`` / ``starting_available`` are the opening account
        figures *as recorded at the start of the window* - normally from the
        balance-snapshot row that began the period. They are inputs, not
        fabrications: replaying an account whose starting balance was never
        recorded means supplying them from the record, not accepting an
        invented number.
        """
        if starting_equity < 0:
            raise ValueError("starting_equity must not be negative.")
        ordered = sorted(steps, key=ReplayStep.order_key)

        positions = PositionManager()
        rates = LocalRateCoordinator()
        open_orders: dict[str, RiskOpenOrderState] = {}
        market: dict[tuple[str, str], RiskMarketDataState] = {}
        config = self._initial_configuration
        realised_today = Decimal(0)
        fees_today = Decimal(0)
        traded_notional_today = Decimal(0)
        consecutive_losses = 0
        peak_equity = starting_equity
        snapshot_version = 0
        decisions: list[ReplayDecision] = []
        events: list[RiskEvent] = []
        seen_fills: set[str] = set()
        day = trading_day_utc(ordered[0].timestamp_micros) if ordered else ""

        gate = RiskGate(configuration=config, simulated=True)

        for step in ordered:
            now = step.timestamp_micros
            rolled = trading_day_utc(now)
            if day and rolled != day:
                # Day roll (UTC) resets the daily accumulators exactly as
                # the live path's day-scoped source does: PnL figures are
                # per-day, and a replay that ignored the roll would evaluate
                # Tuesday against Monday's loss budget.
                realised_today = Decimal(0)
                fees_today = Decimal(0)
                traded_notional_today = Decimal(0)
                consecutive_losses = 0
            day = rolled

            match step.kind:
                case ReplayStepKind.CONFIG_CHANGE:
                    if step.configuration is None:
                        raise ValueError(
                            "A CONFIG_CHANGE step with no configuration "
                            "would silently drop the gate to 'unconfigured' "
                            "mid-replay."
                        )
                    config = step.configuration
                    gate.update_configuration(config)

                case ReplayStepKind.MARKET_UPDATE:
                    if step.symbol is None:
                        raise ValueError("MARKET_UPDATE steps must name a symbol.")
                    market[(step.exchange.value, step.symbol)] = RiskMarketDataState(
                        exchange=step.exchange,
                        symbol=step.symbol,
                        best_bid=step.best_bid,
                        best_ask=step.best_ask,
                        best_bid_quantity=None,
                        best_ask_quantity=None,
                        last_trade_price=step.last_trade_price,
                        last_trade_timestamp_micros=now,
                        quote_timestamp_micros=now,
                        book_health=OrderBookHealth.OK,
                        book_sequence=None,
                        feed_connected=True,
                        simulated=True,
                    )
                    for position in positions.open_positions():
                        feed_state = market.get(
                            (position.exchange.value, position.symbol)
                        )
                        if feed_state is not None and feed_state.mid_price is not None:
                            positions.set_mark_price(
                                position.account_id,
                                position.exchange,
                                position.symbol,
                                feed_state.mid_price,
                            )

                case ReplayStepKind.FILL:
                    fill = self._validated_fill(step, seen_fills)
                    if fill is None:
                        continue  # duplicate fill id - already applied
                    if (
                        fill.exchange is None
                        or fill.symbol is None
                        or fill.side is None
                    ):  # proven by _validated_fill; re-narrowed for the type checker
                        raise ValueError("unreachable: replay fills carry attribution")
                    update = positions.apply_fill(
                        self._tenant_id,
                        self._account_id,
                        fill.exchange,
                        fill.symbol,
                        fill.side,
                        fill,
                    )
                    seen_fills.add(fill.fill_id)
                    realised_today += update.realised_delta
                    fees_today += fill.fee
                    traded_notional_today += fill.notional
                    if update.realised_delta < 0:
                        consecutive_losses += 1
                    elif update.realised_delta > 0:
                        consecutive_losses = 0
                    order = open_orders.get(fill.order_id)
                    if order is not None:
                        if order.filled_quantity + fill.quantity >= order.quantity:
                            open_orders.pop(fill.order_id, None)
                        else:
                            open_orders[fill.order_id] = replace(
                                order,
                                filled_quantity=order.filled_quantity + fill.quantity,
                                source_timestamp_micros=now,
                            )

                case ReplayStepKind.ORDER_CANCEL:
                    if step.cancelled_client_order_id is not None:
                        open_orders.pop(step.cancelled_client_order_id, None)

                case ReplayStepKind.ORDER_SUBMIT:
                    if step.intent is None:
                        raise ValueError("ORDER_SUBMIT step without an intent.")
                    snapshot_version += 1
                    state = self._build_state(
                        now=now,
                        day=day,
                        version=snapshot_version,
                        candidate_strategy_id=step.intent.strategy_id,
                        positions=positions,
                        open_orders=open_orders,
                        market=market,
                        realised_today=realised_today,
                        fees_today=fees_today,
                        traded_notional_today=traded_notional_today,
                        consecutive_losses=consecutive_losses,
                        peak_equity=peak_equity,
                        starting_equity=starting_equity,
                        starting_available=starting_available,
                        quote_asset=quote_asset,
                        rates=rates,
                        config=config,
                    )
                    if state.peak_equity is not None:
                        peak_equity = state.peak_equity
                    outcome: GateOutcome = gate.evaluate(
                        step.intent,
                        state=state,
                        request_id=f"replay-{step.sequence}",
                        trading_mode=TradingMode.PAPER,
                        now_micros=now,
                        decision_id=f"replay-decision-{step.sequence}",
                    )
                    decisions.append(
                        ReplayDecision(
                            step_sequence=step.sequence,
                            timestamp_micros=now,
                            decision_id=outcome.decision.decision_id,
                            code=outcome.decision.code,
                            approved=outcome.decision.approved,
                            snapshot_version=state.version,
                            rule_outcomes=tuple(
                                (item.rule_id.value, item.status.value)
                                for item in outcome.outcomes
                            ),
                        )
                    )
                    events.extend(outcome.events)
                    if outcome.proposed_protections:
                        # Replay *reproduces* protections by applying them to
                        # the replay-local gate only; no world is touched.
                        gate.apply_protections(
                            outcome.proposed_protections, now_micros=now
                        )
                    if outcome.decision.approved:
                        intent = step.intent
                        client_order_id = (
                            intent.client_order_id or f"replay-{step.sequence}"
                        )
                        rates.observe(self._tenant_id, self._account_id, "order", now)
                        open_orders[client_order_id] = RiskOpenOrderState(
                            client_order_id=client_order_id,
                            exchange=intent.exchange,
                            symbol=intent.symbol,
                            side=intent.side,
                            order_type=intent.order_type,
                            status=OrderStatus.SUBMITTED,
                            quantity=intent.quantity,
                            filled_quantity=Decimal(0),
                            is_reduce_only=intent.reduce_only,
                            time_in_force=intent.time_in_force,
                            strategy_id=intent.strategy_id,
                            limit_price=intent.price,
                            source_timestamp_micros=now,
                        )

                case _:
                    raise ValueError(f"Unknown replay step kind {step.kind!r}.")

        final_state = self._build_state(
            now=ordered[-1].timestamp_micros if ordered else 0,
            day=day,
            version=snapshot_version + 1,
            positions=positions,
            open_orders=open_orders,
            market=market,
            realised_today=realised_today,
            fees_today=fees_today,
            traded_notional_today=traded_notional_today,
            consecutive_losses=consecutive_losses,
            peak_equity=peak_equity,
            starting_equity=starting_equity,
            starting_available=starting_available,
            quote_asset=quote_asset,
            rates=rates,
            config=config,
        )
        final_positions = tuple(
            sorted(
                (p.symbol, p.quantity)
                for p in positions.open_positions()
                if p.account_id == self._account_id
            )
        )
        return RiskReplayResult(
            steps_replayed=len(ordered),
            decisions=tuple(decisions),
            events=tuple(events),
            final_positions=final_positions,
            state_digest=final_state.digest(),
            decision_digest=_digest(
                [decision.to_payload() for decision in decisions]
            ),
            event_digest=events_for_replay_digest(events),
            is_simulated=True,
        )

    # -- internals -----------------------------------------------------------------
    @staticmethod
    def _validated_fill(step: ReplayStep, seen_fills: set[str]) -> Fill | None:
        """Fill payload checks; ``None`` means "duplicate, skip".

        Attribution is mandatory in replay history: a fill without symbol/
        side/exchange cannot be applied to the position books, and guessing
        one of the three would make every digest downstream a lie. The live
        OMS stores these on every fill row precisely so this never happens
        to recorded history.
        """
        fill = step.fill
        if fill is None:
            raise ValueError("FILL step without a fill payload.")
        if fill.fill_id in seen_fills:
            return None
        if fill.symbol is None or fill.side is None or fill.exchange is None:
            raise ValueError(
                "Replay fills must carry venue attribution (symbol, side, "
                "exchange); an unattributed fill would move the position of "
                "a guessed symbol."
            )
        return fill

    def _build_state(
        self,
        *,
        now: int,
        day: str,
        version: int,
        positions: PositionManager,
        open_orders: dict[str, RiskOpenOrderState],
        market: Mapping[tuple[str, str], RiskMarketDataState],
        realised_today: Decimal,
        fees_today: Decimal,
        traded_notional_today: Decimal,
        consecutive_losses: int,
        peak_equity: Decimal,
        starting_equity: Decimal,
        starting_available: Decimal | None,
        quote_asset: str,
        rates: LocalRateCoordinator,
        config: RiskConfiguration | None,
        candidate_strategy_id: str | None = None,
    ) -> RiskStateSnapshot:
        marks = {
            symbol: state.mid_price or state.last_trade_price
            for (_exchange_value, symbol), state in market.items()
        }
        held = [p for p in positions.all_for_account(self._account_id) if not p.is_flat]
        unrealised = Decimal(0)
        position_entries: list[RiskPositionState] = []
        for position in sorted(held, key=lambda p: (p.exchange.value, p.symbol)):
            mark = marks.get(position.symbol)
            if mark is not None and position.average_entry_price is not None:
                unrealised += (mark - position.average_entry_price) * position.quantity
            position_entries.append(
                RiskPositionState(
                    exchange=position.exchange,
                    symbol=position.symbol,
                    quantity=position.quantity,
                    average_entry_price=position.average_entry_price,
                    mark_price=mark,
                    source_timestamp_micros=now,
                    strategy_id=None,
                    contains_simulated_fills=position.contains_simulated_fills,
                )
            )
        equity = starting_equity + realised_today + unrealised - fees_today
        available = (
            None
            if starting_available is None
            else max(starting_available + realised_today - fees_today, Decimal(0))
        )
        exchange_values = sorted(
            {p.exchange for p in held} | {order.exchange for order in open_orders.values()}
        )
        primary_exchange = exchange_values[0] if exchange_values else ExchangeId.BINANCE
        market_states = tuple(
            state
            for (exchange_value, _symbol), state in sorted(market.items())
            if exchange_value == primary_exchange.value
        )
        strategy_ids = sorted(
            {
                order.strategy_id
                for order in open_orders.values()
                if order.strategy_id is not None
            }
            | ({candidate_strategy_id} if candidate_strategy_id else set())
        )
        strategy_states = tuple(
            RiskStrategyState(
                strategy_id=strategy_id,
                realised_pnl_today=realised_today,
                unrealised_pnl=unrealised,
                open_order_count=sum(
                    1
                    for order in open_orders.values()
                    if order.strategy_id == strategy_id
                ),
                consecutive_losses=consecutive_losses,
                # Replay has no strategy-lifecycle input; the strategy an
                # order is being evaluated for is enabled by definition at
                # that step, and every figure on the row comes from replay's
                # own books. No lifecycle event is invented.
                is_enabled=True,
                source_timestamp_micros=now,
            )
            for strategy_id in strategy_ids
        )
        return RiskStateSnapshot(
            snapshot_id=str(
                uuid.uuid5(uuid.NAMESPACE_OID, f"{self._account_id}:{version}")
            ),
            version=version,
            tenant_id=self._tenant_id,
            account_id=self._account_id,
            created_at_micros=now,
            trading_day=day,
            config_digest=None if config is None else config.digest,
            config_version=None if config is None else config.config_version,
            account=RiskAccountState(
                tenant_id=self._tenant_id,
                account_id=self._account_id,
                exchange=primary_exchange,
                equity=equity,
                available=available,
                reserved=None,
                source_timestamp_micros=now,
                source_version=version,
                is_simulated=True,
                quote_asset=quote_asset,
                status="REPLAY",
            ),
            positions=tuple(position_entries),
            open_orders=tuple(open_orders[key] for key in sorted(open_orders)),
            market=market_states,
            strategies=strategy_states,
            realised_pnl_today=realised_today,
            unrealised_pnl_today=unrealised,
            fees_today=fees_today,
            traded_notional_today=traded_notional_today,
            consecutive_losses=consecutive_losses,
            peak_equity=max(peak_equity, equity),
            market_type=MarketType.SPOT,
            rate=rates.state_at(self._tenant_id, self._account_id, now),
            missing_sources=frozenset(),
            advisories=frozenset({"risk-replay"}),
            produced_by="risk-replay",
            is_simulated=True,
        )


def _digest(payloads: list[object]) -> str:
    hasher = hashlib.sha256()
    for payload in payloads:
        hasher.update(
            json.dumps(
                payload, sort_keys=True, separators=(",", ":"), default=str
            ).encode("utf-8")
        )
    return hasher.hexdigest()
