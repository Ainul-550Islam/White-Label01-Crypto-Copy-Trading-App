# Tracks submission state, exchange order ID, and idempotency
"""Server-side assembly of one OMS submission (Phase 3).

The worker forwards WHAT to trade; this module decides everything the engine
needs to judge it, from objects this process owns:

* the reference price comes from ``runtime.book_provider`` - the very function
  the paper adapter fills against - so validation, the price-deviation check and
  the simulated fill all read one number;
* every health input starts as unknown (``ComponentHealth()`` blocks) and is
  raised to healthy only when this process has positively observed it;
* the rate window is counted here, per tenant and account, not taken from the
  caller;
* exposure comes from the API's canonical ledger and carries its own
  ``complete`` flag, which maps straight onto ``RiskSnapshot.is_complete``.

Nothing here talks to a venue. The runtime's adapter is the paper simulator
(build_runtime refuses EXECUTION_MODE=live), and this module never constructs
an adapter of its own.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from wlct_trading.adapters.base import SymbolSpecification
from wlct_trading.enums import MarketType, OrderSide, OrderType, TimeInForce
from wlct_trading.execution.engine import ExecutionContext
from wlct_trading.execution.safety import ComponentHealth
from wlct_trading.orders import OrderIntent
from wlct_trading.risk import KillSwitchState, RiskSnapshot

from app.composition import EngineRuntime
from app.schemas import SubmitOrderRequest

__all__ = [
    "RATE_WINDOW_MICROS",
    "PreparedSubmission",
    "prepare_submission",
    "record_submission",
]

#: One minute, the unit ``RiskLimits.max_orders_per_minute`` is expressed in.
RATE_WINDOW_MICROS = 60_000_000


@dataclass(frozen=True, slots=True)
class PreparedSubmission:
    intent: OrderIntent
    context: ExecutionContext
    #: Human-readable reasons any input was left unknown; empty when every
    #: input was positively observed. Logged by the route, never used to
    #: override a verdict.
    unknowns: tuple[str, ...]


def _now_micros() -> int:
    import time

    return time.time_ns() // 1_000


def _orders_in_last_minute(runtime: EngineRuntime, key: tuple[str, str], now: int) -> int:
    window = runtime.submission_windows.get(key)
    if not window:
        return 0
    cutoff = now - RATE_WINDOW_MICROS
    kept = [stamp for stamp in window if stamp > cutoff]
    runtime.submission_windows[key] = kept
    return len(kept)


def record_submission(runtime: EngineRuntime, tenant_id: str, account_id: str, now: int | None = None) -> None:
    """Count a submission that reached the engine (whatever its verdict)."""
    stamp = _now_micros() if now is None else now
    runtime.submission_windows.setdefault((tenant_id, account_id), []).append(stamp)


async def prepare_submission(
    runtime: EngineRuntime,
    body: SubmitOrderRequest,
    *,
    now_micros: int | None = None,
) -> PreparedSubmission:
    """Build the intent and a fail-closed execution context for ``body``."""
    now = _now_micros() if now_micros is None else now_micros
    unknowns: list[str] = []
    exchange = runtime.trading_adapter.exchange

    intent = OrderIntent(
        tenant_id=body.tenant_id,
        account_id=body.account_id,
        strategy_id=body.strategy_id,
        exchange=exchange,
        symbol=body.symbol,
        side=OrderSide(body.side),
        order_type=OrderType(body.order_type),
        quantity=Decimal(body.quantity),
        price=Decimal(body.price) if body.price is not None else None,
        time_in_force=TimeInForce(body.time_in_force),
        reduce_only=body.reduce_only,
        client_order_id=body.client_order_id,
        metadata={
            **dict(body.metadata),
            "platformOrderId": body.order_id,
            "riskDecisionId": body.risk_decision_id,
        },
    )

    spec_view = body.specification
    specification = SymbolSpecification(
        symbol=body.symbol,
        venue_symbol=body.symbol,
        exchange=exchange,
        market_type=MarketType(spec_view.market_type),
        base_asset=spec_view.base_asset,
        quote_asset=spec_view.quote_asset,
        price_tick=Decimal(spec_view.price_tick),
        quantity_step=Decimal(spec_view.quantity_step),
        min_quantity=Decimal(spec_view.min_quantity),
        max_quantity=Decimal(spec_view.max_quantity) if spec_view.max_quantity is not None else None,
        min_notional=Decimal(spec_view.min_notional),
        is_tradeable=spec_view.is_tradeable,
        price_precision=spec_view.price_precision,
        quantity_precision=spec_view.quantity_precision,
    )

    # --- reference price: the simulator's own book, or nothing ---------------
    reference_price: Decimal | None = None
    market_data_health = ComponentHealth.down("No reference book is configured for this runtime.")
    provider = runtime.book_provider
    if provider is not None:
        try:
            book = provider(exchange, body.symbol)
        except Exception as error:  # a broken provider is "no data", never a price
            book = None
            unknowns.append(f"book provider raised {type(error).__name__}")
        if book is not None:
            reference_price = book.mid_price
    if reference_price is not None and reference_price > 0:
        market_data_health = ComponentHealth.ok(
            "Simulated reference book (EXECUTION_SIMULATED_MID).", age_micros=0
        )
    else:
        reference_price = None
        unknowns.append("no reference price: EXECUTION_SIMULATED_MID is not configured")

    # --- open orders from this runtime's store --------------------------------
    open_orders: tuple = ()
    store_ok = True
    try:
        open_orders = await runtime.store.list_open_orders(body.tenant_id, body.account_id)
    except Exception as error:  # an unreadable store is an unknown risk state
        store_ok = False
        unknowns.append(f"order store unreadable: {type(error).__name__}")

    exposure = body.exposure
    snapshot = RiskSnapshot(
        position_quantity=Decimal(exposure.position_quantity),
        symbol_exposure_notional=Decimal(exposure.symbol_exposure_notional),
        account_exposure_notional=Decimal(exposure.account_exposure_notional),
        open_order_count=len(open_orders),
        orders_in_last_minute=_orders_in_last_minute(
            runtime, (body.tenant_id, body.account_id), now
        ),
        # The API's unified risk decision (named by riskDecisionId) owns the
        # daily-loss limit; when it does not forward a figure the engine's own
        # daily-loss rule sees zero and the API decision remains the gate.
        realised_pnl_today=(
            Decimal(exposure.realised_pnl_today)
            if exposure.realised_pnl_today is not None
            else Decimal(0)
        ),
        strategy_realised_pnl_today=Decimal(0),
        reference_price=reference_price,
        market_data_age_micros=0 if reference_price is not None else None,
        book_usable=reference_price is not None,
        is_complete=bool(exposure.complete) and store_ok,
        known_client_order_ids=frozenset(order.client_order_id for order in open_orders),
    )
    if not exposure.complete:
        unknowns.append("API reported the exposure ledger as incomplete")

    risk_health = (
        ComponentHealth.ok("Risk state assembled for this submission.", age_micros=0)
        if snapshot.is_complete
        else ComponentHealth.down("Risk state incomplete; refusing to evaluate against it.")
    )

    # The paper adapter is in-process: reachable by construction. A runtime
    # whose adapter is not simulated never reaches this route (live refuses to
    # boot), and if one ever did it would be reported as unknown here.
    exchange_health = (
        ComponentHealth.ok("In-process paper simulator.")
        if runtime.trading_adapter.is_simulated
        else ComponentHealth.down("Non-simulated adapter: venue health is not observed here.")
    )

    context = ExecutionContext(
        snapshot=snapshot,
        # Kill switches are owned by the API's risk/kill-switch plane and are
        # part of the decision named by riskDecisionId; this runtime holds no
        # switch state of its own to add.
        kill_switches=KillSwitchState(
            global_engaged=False,
            engaged_exchanges=frozenset(),
            engaged_strategies=frozenset(),
            engaged_symbols=frozenset(),
            reason=None,
        ),
        specification=specification,
        reference_price=reference_price,
        risk_health=risk_health,
        market_data_health=market_data_health,
        exchange_health=exchange_health,
        credentials=None,
        market_data_required=True,
    )
    return PreparedSubmission(intent=intent, context=context, unknowns=tuple(unknowns))
