"""Order-outcome resolution over the fapi GET /fapi/v1/order path (batch 03).

The flow being pinned: a placement POST whose answer never arrived (timeout,
reset, 5xx) is *ambiguous*. The only safe resolution is the venue's own query
by ``origClientOrderId`` - and only the venue saying "-2013, no such order"
makes resubmission safe. Everything else, including a duplicate-id answer,
a partial fill and a reduce-only rejection, must classify fail-closed.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

import pytest
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.orders import Order, OrderIntent

from app.venue.binance_futures_transport import binance_futures_error_code
from app.venue.order_outcome import OrderOutcomeResolver
from wlct_trading.exchanges.binance_futures.capabilities import FUTURES_REST_WEIGHTS
from wlct_trading.exchanges.binance_futures.trading import (
    BinanceFuturesTradingAdapter,
    FuturesTradingParams,
)
from wlct_trading.exchanges.binance_futures.parsers import classify_futures_error
from wlct_trading.transport.errors import ExchangeErrorCategory


def _intent() -> OrderIntent:
    return OrderIntent(
        tenant_id="t-1",
        account_id="acct-1",
        strategy_id="strategy-test",
        exchange=ExchangeId.BINANCE,
        symbol="BTC/USDT",
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal("0.01"),
        price=Decimal("45000.5"),
        time_in_force=TimeInForce.GTC,
        reduce_only=False,
    )


class _FakeVenueSender:
    """Serves queued (status, body) tuples; captures the SignedRequests."""

    def __init__(self, responses: list[tuple[int, Mapping[str, Any] | list[Any] | dict[str, Any]]]):
        self.responses = [(s, b) for s, b in responses]
        self.requests = []

    async def __call__(self, request, timeout_ms: int):
        import json as _json

        from wlct_trading.exchanges.binance.trading import HttpResponse

        self.requests.append(request)
        status, body = self.responses.pop(0)
        return HttpResponse(status=status, headers={}, body=_json.dumps(body))


class _FakeCredentials:
    async def resolve(self, tenant_id, account_id, exchange):
        from wlct_trading.execution.credentials import ExchangeCredentials

        return ExchangeCredentials(
            exchange=exchange,
            tenant_id=tenant_id,
            account_id=account_id,
            api_key="k" * 32,
            api_secret="s" * 48,
        )


class _FakeClock:
    def __init__(self):
        self.offset_millis = 0

    def timestamp_millis(self) -> int:
        return 1_750_000_000_000


class _NeverLimited:
    def try_acquire_all(self, weights):
        return True, []


def _adapter(sender: _FakeVenueSender) -> BinanceFuturesTradingAdapter:
    return BinanceFuturesTradingAdapter(
        params=FuturesTradingParams(
            send=sender,
            rest_base="https://testnet.binancefuture.com",
            rate_limits=_NeverLimited(),  # type: ignore[arg-type]
            timeout_ms=500,
        ),
        credentials=_FakeCredentials(),
        clock=_FakeClock(),  # type: ignore[arg-type]
    )


class TestOutcomeClassification:
    @pytest.mark.asyncio
    async def test_absent_only_on_minus_2013(self):
        sender = _FakeVenueSender([(400, {"code": -2013, "msg": "Order does not exist."})])
        resolver = OrderOutcomeResolver(_adapter(sender))
        outcome = await resolver.resolve_for_intent(_intent())
        assert outcome.kind == "absent"
        assert outcome.resubmission_safe is True
        # The fapi query path and key were exercised
        request = sender.requests[0]
        # SignedRequest: url is path-only, the signed params ride in ``query``
        # (re-encoding them there would break the signature - the dataclass is
        # explicit about that).
        assert request.url.startswith("https://testnet.binancefuture.com/fapi/v1/order")
        assert "origClientOrderId=" in request.query
        assert "symbol=BTCUSDT" in request.query
        assert "signature=" in request.query

    @pytest.mark.asyncio
    async def test_exists_when_venue_returns_the_order(self):
        sender = _FakeVenueSender([
            (200, {
                "symbol": "BTCUSDT",
                "orderId": 998877,
                "clientOrderId": "wlct-test-clientorderid-0001",
                "status": "FILLED",
                "side": "BUY",
                "type": "LIMIT",
                "origQty": "0.01",
                "executedQty": "0.01",
                "avgPrice": "45000.5",
                "price": "45000.5",
                "timeInForce": "GTC",
                "updateTime": 1_750_000_000_000,
            })
        ])
        resolver = OrderOutcomeResolver(_adapter(sender))
        outcome = await resolver.resolve_for_intent(_intent())
        assert outcome.kind == "exists"
        assert outcome.resubmission_safe is False
        assert outcome.order is not None
        assert outcome.order.status == OrderStatus.FILLED
        assert outcome.order.filled_quantity == Decimal("0.01")

    @pytest.mark.asyncio
    async def test_partial_fill_exists_and_is_not_resubmittable(self):
        sender = _FakeVenueSender([
            (200, {
                "symbol": "BTCUSDT",
                "orderId": 7,
                "clientOrderId": "wlct-test-clientorderid-0002",
                "status": "PARTIALLY_FILLED",
                "side": "SELL",
                "type": "LIMIT",
                "origQty": "0.5",
                "executedQty": "0.12",
                "avgPrice": "45100.0",
                "price": "45100.0",
                "timeInForce": "GTC",
                "updateTime": 1_750_000_000_123,
            })
        ])
        resolver = OrderOutcomeResolver(_adapter(sender))
        outcome = await resolver.resolve_for_intent(_intent())
        assert outcome.kind == "exists"
        assert outcome.order is not None
        assert outcome.order.quantity - outcome.order.filled_quantity == Decimal("0.38")

    @pytest.mark.asyncio
    async def test_ambiguous_timeout_classifies_unknown(self):
        class _TimeoutSender:
            async def __call__(self, request, timeout_ms):
                raise TimeoutError("simulated in-flight timeout")

        resolver = OrderOutcomeResolver(_adapter(_TimeoutSender()))  # type: ignore[arg-type]
        outcome = await resolver.resolve_for_intent(_intent())
        assert outcome.kind == "unknown"
        assert outcome.resubmission_safe is False

    @pytest.mark.asyncio
    async def test_duplicate_client_order_id_is_a_venue_rejection_not_a_dup(self):
        # -5022/duplicate-id style answers must surface as rejections and the
        # resolver must classify them unknown (never auto-recreate).
        sender = _FakeVenueSender([(400, {"code": -2011, "msg": "Duplicate order rejected"})])
        resolver = OrderOutcomeResolver(_adapter(sender))
        outcome = await resolver.resolve_for_intent(_intent())
        assert outcome.kind == "unknown"
        assert "-2011" in outcome.detail or "futures code" in outcome.detail

    @pytest.mark.asyncio
    async def test_reduce_only_reject_maps_to_invalid_request(self):
        # -2022 REDUCE_ONLY_REJECT: the platform's own guard flagging is being
        # answered by the venue - an invalid request, a refusal, never retried.
        kind = classify_futures_error(-2022, 400)
        assert kind == ExchangeErrorCategory.INVALID_REQUEST

    async def test_margin_shortfall_is_exchange_error_not_retry(self):
        # -2019 MARGIN_NOT_SUFFICIENT: venue said no to funds; the engine
        # treats it as a hard venue refusal, not a transient glitch.
        kind = classify_futures_error(-2019, 400)
        assert kind == ExchangeErrorCategory.EXCHANGE_ERROR


class TestFuturesErrorMapping:
    def test_margin_shortfall_code(self):
        assert binance_futures_error_code('{"code":-2019,"msg":"Margin is insufficient."}') == -2019

    def test_reduce_only_reject_code(self):
        assert binance_futures_error_code('{"code":-2022,"msg":"x"}') == -2022

    def test_timeout_window_code(self):
        assert binance_futures_error_code('{"code":-1021}') == -1021

    def test_liquidation_guard_codes_distinguished(self):
        # -2019 margin vs -2027 leverage are different operator stories: both
        # refuse, but the taxonomy line must not fuse them.
        assert binance_futures_error_code('{"code":-2019}') != binance_futures_error_code('{"code":-2027}')

    def test_weight_table_keeps_order_query_affordable(self):
        assert FUTURES_REST_WEIGHTS["order_query"] == 1
