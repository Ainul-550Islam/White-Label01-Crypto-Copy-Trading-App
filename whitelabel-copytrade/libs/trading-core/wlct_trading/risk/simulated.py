"""Builder for simulated risk state - the one constructor paper and backtests share.

Two reasons this lives in the risk package rather than in each session:

1. **One definition of simulated state.** If paper and backtest each grew
   their own snapshot assembly, the two would drift, and "the risk state a
   backtest evaluated" would silently differ from "the risk state the paper
   session evaluated" — invalidating the exact comparison (backtest vs.
   paper vs. live) that makes the numbers mean anything.
2. **The honesty of the numbers.** Every field here is derived from an
   explicitly supplied input; nothing is looked up, guessed or defaulted
   from a real venue. Equity and available cash come from the *simulated
   portfolio* the caller owns; market state comes from the replayed/book
   view the caller holds. The builder refuses (``ValueError``) rather than
   invents when an input is inconsistent (negative equity, terminal status
   in the open-order set).

``is_simulated=True`` is not a courtesy label: the live-constructed gate
rejects snapshots built here on the simulated/live pairing check, and
rejections and events produced from them carry the label all the way to the
admin and mobile surfaces.

Both the paper session and the backtest engine call this only when an
extended :class:`~wlct_trading.risk.evaluator.RiskGate` is wired; without a
gate the Part 2/5 core path runs exactly as before, on its own snapshot
type.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderBookHealth,
    OPEN_ORDER_STATUSES,
)
from wlct_trading.market_data import BookTop
from wlct_trading.risk.configuration import RiskConfiguration
from wlct_trading.risk.freshness import trading_day_utc
from wlct_trading.risk.rate_limits import RiskRateState
from wlct_trading.risk.snapshot import (
    RiskAccountState,
    RiskMarketDataState,
    RiskOpenOrderState,
    RiskPositionState,
    RiskStateSnapshot,
    RiskStrategyState,
)

__all__ = ["SimulatedRiskInputs", "build_simulated_state"]

_ZERO = Decimal(0)


@dataclass(slots=True, frozen=True)
class SimulatedRiskInputs:
    """Everything derived from a simulated portfolio/session - no live input.

    The identity fields (tenant/account/symbol) must match the gate's; the
    gate re-checks them on the snapshot and refuses on mismatch, so a caller
    mixing sessions gets a refusal, not a blended state.
    """

    tenant_id: str
    account_id: str
    exchange: ExchangeId
    symbol: str
    strategy_id: str | None
    now_micros: int
    version: int
    #: Simulated portfolio figures, passed through exactly as the portfolio
    # reports them. ``None`` unrealised PnL means "no mark", which loss-rule
    # semantics read as unverifiable, not zero - the same rule the live path
    # obeys.
    position_quantity: Decimal
    average_entry_price: Decimal | None
    mark_price: Decimal | None
    equity: Decimal
    available_cash: Decimal | None
    realised_pnl_today: Decimal
    unrealised_pnl_today: Decimal | None
    fees_today: Decimal
    traded_notional_today: Decimal
    peak_equity: Decimal | None = None
    consecutive_losses: int = 0
    #: Resting simulated orders (open only - terminal ones have been applied
    # to the portfolio by the caller, exactly as the live OMS guarantees).
    open_orders: tuple[RiskOpenOrderState, ...] = ()
    book_top: BookTop | None = None
    orders_in_last_minute: int = 0
    cancels_in_last_minute: int = 0
    #: The configuration the gate is running, if any: it is echoed into the
    # snapshot so the binding check *passes on identity* rather than being
    # vacuously skipped - a simulated snapshot with an unbound config digest
    # would evaluate against whatever config the gate happens to hold.
    configuration: RiskConfiguration | None = None
    session_note: str = "simulated-risk-state"


def build_simulated_state(inputs: SimulatedRiskInputs) -> RiskStateSnapshot:
    """Freeze ``inputs`` into an immutable simulated snapshot."""
    if inputs.version < 1:
        raise ValueError("Simulated snapshot version must be >= 1.")
    if inputs.equity < _ZERO:
        raise ValueError(
            "Simulated equity is negative; a portfolio model that allows "
            "that is modelling margin, and this builder models spot."
        )
    if inputs.available_cash is not None and inputs.available_cash < _ZERO:
        raise ValueError("Simulated available cash is negative.")
    for order in inputs.open_orders:
        if order.status not in OPEN_ORDER_STATUSES:
            raise ValueError(
                f"Simulated open-order {order.client_order_id} carries status "
                f"{order.status.value}; terminal orders must be folded into "
                "the position before the snapshot is built."
            )
        if order.exchange is not inputs.exchange or order.symbol != inputs.symbol:
            raise ValueError(
                "Simulated open orders must belong to the session's "
                "exchange+symbol; cross-session blending is a wiring bug."
            )
    if inputs.book_top is not None:
        if inputs.book_top.exchange is not inputs.exchange:
            raise ValueError("Book top belongs to a different exchange.")
        if inputs.book_top.symbol != inputs.symbol:
            raise ValueError("Book top belongs to a different symbol.")

    market = _market_state(inputs)
    position = RiskPositionState(
        exchange=inputs.exchange,
        symbol=inputs.symbol,
        quantity=inputs.position_quantity,
        average_entry_price=inputs.average_entry_price,
        mark_price=inputs.mark_price,
        source_timestamp_micros=inputs.now_micros,
        strategy_id=inputs.strategy_id,
        contains_simulated_fills=True,
    )
    strategies = (
        ()
        if inputs.strategy_id is None
        else (
            RiskStrategyState(
                strategy_id=inputs.strategy_id,
                realised_pnl_today=inputs.realised_pnl_today,
                unrealised_pnl=inputs.unrealised_pnl_today,
                open_order_count=sum(
                    1
                    for order in inputs.open_orders
                    if order.strategy_id == inputs.strategy_id
                ),
                consecutive_losses=inputs.consecutive_losses,
                is_enabled=True,
                source_timestamp_micros=inputs.now_micros,
            ),
        )
    )
    rate = RiskRateState(
        measured_at_micros=inputs.now_micros,
        # The sessions track order times minute-wide; per-second detail is a
        # live-venue concern (a simulator consumes no real rate limit), so
        # the second buckets honestly report None and any per-second rule
        # reports UNVERIFIABLE - refused, never zero-filled.
        orders_last_second=None,
        orders_last_minute=inputs.orders_in_last_minute,
        cancels_last_second=None,
        cancels_last_minute=inputs.cancels_in_last_minute,
    )
    return RiskStateSnapshot(
        snapshot_id=str(
            uuid.uuid5(
                uuid.NAMESPACE_OID,
                f"{inputs.tenant_id}:{inputs.account_id}:sim:{inputs.version}",
            )
        ),
        version=inputs.version,
        tenant_id=inputs.tenant_id,
        account_id=inputs.account_id,
        created_at_micros=inputs.now_micros,
        trading_day=trading_day_utc(inputs.now_micros),
        config_digest=(
            None if inputs.configuration is None else inputs.configuration.digest
        ),
        config_version=(
            None
            if inputs.configuration is None
            else inputs.configuration.config_version
        ),
        account=RiskAccountState(
            tenant_id=inputs.tenant_id,
            account_id=inputs.account_id,
            exchange=inputs.exchange,
            equity=inputs.equity,
            available=inputs.available_cash,
            reserved=None,
            source_timestamp_micros=inputs.now_micros,
            source_version=inputs.version,
            is_simulated=True,
            quote_asset="USD",
            status="SIMULATED",
        ),
        positions=(position,),
        open_orders=inputs.open_orders,
        market=() if market is None else (market,),
        strategies=strategies,
        realised_pnl_today=inputs.realised_pnl_today,
        unrealised_pnl_today=inputs.unrealised_pnl_today,
        fees_today=inputs.fees_today,
        traded_notional_today=inputs.traded_notional_today,
        consecutive_losses=inputs.consecutive_losses,
        peak_equity=inputs.peak_equity,
        market_type=MarketType.SPOT,
        rate=rate,
        missing_sources=frozenset()
        if market is not None
        else frozenset({"market"}),
        advisories=frozenset({inputs.session_note}),
        produced_by="simulated-session",
        is_simulated=True,
    )


def _market_state(inputs: SimulatedRiskInputs) -> RiskMarketDataState | None:
    book = inputs.book_top
    if book is None:
        return None
    crossed = book.best_bid is not None and book.best_ask is not None and book.best_bid >= book.best_ask
    return RiskMarketDataState(
        exchange=inputs.exchange,
        symbol=inputs.symbol,
        best_bid=book.best_bid,
        best_ask=book.best_ask,
        best_bid_quantity=book.best_bid_quantity,
        best_ask_quantity=book.best_ask_quantity,
        last_trade_price=None,
        last_trade_timestamp_micros=None,
        quote_timestamp_micros=book.exchange_timestamp,
        book_health=OrderBookHealth.CROSSED if crossed else OrderBookHealth.OK,
        book_sequence=book.sequence,
        # Simulated sessions have no websocket; "connected" for them means
        # "the replay source is feeding", which it is while this state is
        # being built - the flag reports that fact, not a fake socket.
        feed_connected=True,
        simulated=True,
    )
