"""Part 11, step 25: the observe-only invariant on the money path.

The claim under test, in one sentence: attaching, detaching, or fully
breaking the ENGINE's observational outlets - the event publisher and the
tracer - must not change a single execution verdict, store state, or
incident record. The engine's module docs promise it ("publishing is
best-effort"); this file makes the promise expensive to break by testing
the whole composed runtime around a real paper adapter and the real
in-memory stores, not a mock of them.

Why this belongs in the CORE suite (not the service): the guards live at
the call sites here, and a future "simplification" that lets a publisher
exception escape would break the money path from the inside. A service-level
test could not tell that story.

The chaos arms are deliberately loud: an exploding publisher raises on EVERY
call from EVERY event (submit accepted path, cancel terminal path), which is
strictly nastier than the partial failures a bad night in production
actually produces. Latency fields are excluded from comparisons because
they measure the machine, not the verdict; that exclusion is stated here so
the only volatile fields left out are the ones a reviewer can count.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

from wlct_trading.adapters.paper import PaperTradingAdapter
from wlct_trading.enums import (
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
)
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.engine import ExecutionEngine
from wlct_trading.execution.incidents import InMemoryIncidentRecorder
from wlct_trading.execution.locks import InMemoryLockManager
from wlct_trading.execution.store import InMemoryOrderStore
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Order
from wlct_trading.risk import RiskEngine, RiskLimits

_MID = Decimal("50000")


def _book(_exchange: ExchangeId, symbol: str) -> BookTop:
    return BookTop(
        exchange=ExchangeId.PAPER,
        symbol=symbol,
        best_bid=_MID,
        best_bid_quantity=Decimal("1"),
        best_ask=_MID,
        best_ask_quantity=Decimal("1"),
        sequence=1,
        exchange_timestamp=1_700_000_000_000,
        received_timestamp=1_700_000_000_000,
    )


class ExplodingPublisher:
    """Raises on every call - and counts them, so the test proves the
    explosion happened on the path being compared."""

    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self, event_type: str, payload: object) -> None:
        self.calls += 1
        raise RuntimeError(f"publisher exploded on {event_type}")


class ExplodingTracer:
    """Not a Tracer - the point is that engine code paths touching the
    tracer must ALSO survive a dependency that has fully caught fire,
    because the engine only holds a Tracer by duck contract, not by type."""

    def start_span(self, *args: object, **kwargs: object) -> object:
        raise RuntimeError("tracer exploded")


def build_engine(
    *,
    publish_event: object | None = None,
    tracer: object | None = None,
) -> tuple[ExecutionEngine, InMemoryOrderStore, InMemoryIncidentRecorder]:
    store = InMemoryOrderStore()
    incidents = InMemoryIncidentRecorder()
    engine = ExecutionEngine(
        adapter=PaperTradingAdapter(_book),
        settings=ExecutionSettings(
            live_trading_enabled=False,
            dry_run=False,
            paper_trading=True,
            trading_mode_setting="PAPER",
            trading_enabled=True,
            live_trading_confirmed=False,
        ),
        risk_engine=RiskEngine(RiskLimits()),
        store=store,
        locks=InMemoryLockManager(),
        incidents=incidents,
        publish_event=publish_event,
        tracer=tracer,
    )
    return engine, store, incidents


def seed_order() -> Order:
    return Order(
        order_id="ord-observe-1",
        client_order_id="clord-observe-1",
        tenant_id="tenant-a",
        account_id="acct-1",
        strategy_id=None,
        exchange=ExchangeId.PAPER,
        symbol="BTCUSDT",
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal("0.01"),
        price=_MID,
        is_simulated=True,
        status=OrderStatus.ACKNOWLEDGED,
    )


def outcome_of(result: object) -> dict[str, object]:
    """Verdict fields, minus what legitimately varies run to run."""
    return {
        "outcome": getattr(result, "outcome").value,
        "clientOrderId": getattr(result, "client_order_id"),
        "errorCode": None
        if getattr(result, "error_code") is None
        else getattr(result, "error_code").value,
        "message": getattr(result, "message"),
        "orderStatus": getattr(result, "order").status.value,
        "transmitted": getattr(result, "transmitted"),
        "isSimulated": getattr(result, "is_simulated"),
    }


async def read_store(store: InMemoryOrderStore, tenant: str, order_id: str) -> dict[str, object]:
    order = await store.get_order(tenant, order_id)
    events = await store.list_events(tenant, order_id)
    state = await store.get_reconciliation_state(tenant, order_id)
    return {
        "status": None if order is None else order.status.value,
        "events": [
            (
                e.status.value,
                e.previous_status.value if e.previous_status else None,
                e.reason,
            )
            for e in events
        ],
        "reconciliation": state.value,
    }


def store_view(store: InMemoryOrderStore, tenant: str, order_id: str) -> dict[str, object]:
    # Sync callers only; async contexts call read_store directly (nested
    # asyncio.run is illegal, and a test helper must not rediscover that at
    # 2am via a RuntimeError).
    return asyncio.run(read_store(store, tenant, order_id))


class TestObserveOnlyInvariant:
    def test_cancel_verdict_identical_with_exploding_publisher(self) -> None:
        baseline_engine, baseline_store, baseline_incidents = build_engine()
        boom = ExplodingPublisher()
        chaos_engine, chaos_store, chaos_incidents = build_engine(publish_event=boom)

        baseline_order = seed_order()
        chaos_order = seed_order()
        baseline_result = asyncio.run(baseline_engine.cancel(baseline_order))
        chaos_result = asyncio.run(chaos_engine.cancel(chaos_order))

        # The explosion MUST have happened (otherwise this proves nothing):
        # cancel emits order.cancelled through _emit on the success path.
        assert boom.calls >= 1
        assert outcome_of(baseline_result) == outcome_of(chaos_result)
        assert store_view(baseline_store, "tenant-a", "ord-observe-1") == store_view(
            chaos_store, "tenant-a", "ord-observe-1"
        )
        assert len(baseline_incidents.all) == len(chaos_incidents.all)

    def test_cancel_verdict_identical_with_absent_publisher(self) -> None:
        without = asyncio.run(run_cancel(build_engine()))
        with_boom = ExplodingPublisher()
        with_ = asyncio.run(run_cancel(build_engine(publish_event=with_boom)))
        assert without == with_
        assert with_boom.calls >= 1  # and it still changed nothing

    def test_exploding_tracer_is_not_on_the_engine_path(self) -> None:
        """The engine touches the tracer only where its own contract already
        swallowed everything (start_span sites are guarded at the Tracer
        level). A tracer object that raises the moment it is touched must not
        be reachable from the cancel path at all - if this test ever starts
        failing, someone put a raw tracer call on a money-path branch."""
        engine, store, _ = build_engine(tracer=ExplodingTracer())
        result = asyncio.run(engine.cancel(seed_order()))
        assert result.outcome.value == "ACCEPTED"
        assert store_view(store, "tenant-a", "ord-observe-1")["status"] == "CANCELLED"

    def test_terminal_cancel_rejection_stable_under_chaos(self) -> None:
        """The refusal path (already-terminal order) publishes nothing new,
        and it too must be byte-identical verdicts across wirings - the
        invariant is about the WIRING being irrelevant, not about the path
        being interesting."""
        quiet_engine, _, _ = build_engine()
        order = seed_order()
        order.status = OrderStatus.CANCELLED
        quiet_result = asyncio.run(quiet_engine.cancel(order))

        boom = ExplodingPublisher()
        chaos_engine, _, _ = build_engine(publish_event=boom)
        order2 = seed_order()
        order2.status = OrderStatus.CANCELLED
        chaos_result = asyncio.run(chaos_engine.cancel(order2))

        assert outcome_of(quiet_result) == outcome_of(chaos_result)
        assert quiet_result.error_code is not None  # REJECTED_LOCALLY, as designed
        assert boom.calls == 0  # the terminal refusal never reaches the publisher


async def run_cancel(
    built: tuple[ExecutionEngine, InMemoryOrderStore, InMemoryIncidentRecorder],
) -> dict[str, object]:
    engine, store, incidents = built
    result = await engine.cancel(seed_order())
    return {
        **outcome_of(result),
        **await read_store(store, "tenant-a", "ord-observe-1"),
        "incidents": len(incidents.all),
    }
