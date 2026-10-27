"""Ambiguous placement outcomes are resolved by asking the venue, never by resending.

The resolver's whole contract is the classification: ``exists`` and
``unknown`` both mean "do not resubmit", for opposite reasons (the order is
there / nobody proved it is not). Only the venue's explicit ``-2013`` -
surfaced by the adapter as ``None`` - may green-light a resubmission.
"""

from __future__ import annotations

from decimal import Decimal

from wlct_trading.adapters.base import AdapterConnectionError, AdapterRejectedError
from wlct_trading.enums import ExchangeId, OrderSide, OrderType
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.orders import Order, OrderIntent

from app.venue.order_outcome import OrderOutcomeResolver, client_order_id_for


def _intent(**overrides: object) -> OrderIntent:
    base: dict[str, object] = {
        "tenant_id": "tenant-a",
        "account_id": "acct-1",
        "strategy_id": "strat-1",
        "exchange": ExchangeId.BINANCE,
        "symbol": "BTCUSDT",
        "side": OrderSide.BUY,
        "order_type": OrderType.MARKET,
        "quantity": Decimal("0.010"),
    }
    base.update(overrides)
    return OrderIntent(**base)  # type: ignore[arg-type]


class _Reader:
    """The adapter slice the resolver needs, with a scripted venue answer."""

    def __init__(self, answer: object) -> None:
        self._answer = answer
        self.seen_client_order_id: str | None = None

    async def fetch_order_for(self, order: Order) -> Order | None:
        self.seen_client_order_id = order.client_order_id
        if isinstance(self._answer, Exception):
            raise self._answer
        return self._answer  # type: ignore[return-value]

    def remember_client_order_id(
        self,
        tenant_id: str,
        account_id: str,
        venue_order_id: str,
        client_order_id: str,
    ) -> None:
        return None


class TestDeterministicIdentity:
    def test_client_order_id_derives_from_the_intent(self) -> None:
        intent = _intent()
        assert client_order_id_for(intent) == build_client_order_id(intent)
        # Deterministic: an equal intent derives the same venue identity,
        # which is what makes the outcome lookup possible at all.
        assert client_order_id_for(_intent()) == client_order_id_for(intent)

    def test_different_intents_derive_different_ids(self) -> None:
        assert client_order_id_for(_intent()) != client_order_id_for(
            _intent(quantity=Decimal("0.020"))
        )


class TestResolve:
    async def test_venue_holds_the_order_means_exists_and_no_resubmit(self) -> None:
        intent = _intent()
        venue_view = Order.from_intent(
            intent, client_order_id=build_client_order_id(intent)
        )
        reader = _Reader(venue_view)
        outcome = await OrderOutcomeResolver(reader).resolve_for_intent(intent)
        assert outcome.kind == "exists"
        assert outcome.order is venue_view
        assert outcome.resubmission_safe is False
        # The lookup used the deterministic id (origClientOrderId upstream).
        assert reader.seen_client_order_id == build_client_order_id(intent)

    async def test_venue_says_no_such_order_is_the_only_resubmit_state(
        self,
    ) -> None:
        outcome = await OrderOutcomeResolver(_Reader(None)).resolve_for_intent(
            _intent()
        )
        assert outcome.kind == "absent"
        assert outcome.order is None
        assert outcome.resubmission_safe is True

    async def test_connection_failure_is_unknown_never_absent(self) -> None:
        reader = _Reader(AdapterConnectionError("TIMEOUT", "read timed out"))
        outcome = await OrderOutcomeResolver(reader).resolve_for_intent(_intent())
        assert outcome.kind == "unknown"
        assert outcome.resubmission_safe is False

    async def test_a_rejected_query_proves_nothing_about_the_order(self) -> None:
        reader = _Reader(
            AdapterRejectedError("-1022", "Signature for this request is not valid.")
        )
        outcome = await OrderOutcomeResolver(reader).resolve_for_intent(_intent())
        assert outcome.kind == "unknown"
        assert outcome.resubmission_safe is False

    async def test_order_without_client_order_id_cannot_be_resolved(self) -> None:
        order = Order.from_intent(_intent(), client_order_id="")
        outcome = await OrderOutcomeResolver(_Reader(None)).resolve(order)
        assert outcome.kind == "unknown"
        assert outcome.resubmission_safe is False

    async def test_explicit_intent_client_order_id_wins_over_derivation(
        self,
    ) -> None:
        intent = _intent(client_order_id="wlct-explicit-1")
        reader = _Reader(None)
        outcome = await OrderOutcomeResolver(reader).resolve_for_intent(intent)
        assert outcome.client_order_id == "wlct-explicit-1"
        assert reader.seen_client_order_id == "wlct-explicit-1"
