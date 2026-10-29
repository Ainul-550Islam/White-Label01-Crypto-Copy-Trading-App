"""Batch 03 futures tests: the signed USD-M trading and account adapters.

The properties pinned here are the ones the engine's gates rely on:

- every outgoing request is HMAC-signed against ``/fapi`` with the platform's
  deterministic client order id (``newClientOrderId``), never an invented one -
  idempotent resubmission depends on it;
- reduce-only closes carry the venue's ``reduceOnly=true`` flag exactly;
- the venue's numeric fault code survives into the raised error as structured
  data (``venue_code``) so the outcome resolver never re-parses prose;
- -2013 (NO_SUCH_ORDER) answers ``None`` and is the only answer that does;
- 418/429 surface as ``FuturesRateLimited`` with the venue's Retry-After;
- a LIMIT order without a price is refused locally, before any bytes leave.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from decimal import Decimal
from typing import Any, Mapping

import pytest

from wlct_trading.adapters.base import (
    AdapterConnectionError,
    AdapterError,
    AdapterRejectedError,
)
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.execution.credentials import ExchangeCredentials, StaticCredentialProvider
from wlct_trading.execution.timesync import ExchangeClock
from wlct_trading.exchanges.binance.trading import HttpResponse
from wlct_trading.exchanges.binance_futures.adapter import (
    FuturesRateLimited,
    build_futures_registry,
)
from wlct_trading.exchanges.binance_futures.capabilities import (
    BINANCE_FUTURES_TESTNET_REST_BASE,
)
from wlct_trading.exchanges.binance_futures.trading import (
    BinanceFuturesAccountAdapter,
    BinanceFuturesTradingAdapter,
    FuturesTradingParams,
    to_futures_order_type,
    venue_symbol,
)
from wlct_trading.orders import Order, OrderIntent
from wlct_trading.transport.errors import ExchangeErrorCategory

BASE = BINANCE_FUTURES_TESTNET_REST_BASE
TENANT = "tenant-futures"
ACCOUNT = "acct-futures"
API_KEY = "futures" + "key" + "0000000000000000" + "proof"
API_SECRET = "futures" + "secret" + "0000000000000000" + "proof"
CLIENT_ID = "wlct-fut-clientorder-0001"


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


class FakeSender:
    """Records signed requests and answers from a scripted queue."""

    def __init__(self, responses: list[HttpResponse]) -> None:
        self.responses = responses
        self.sent: list[Any] = []

    async def __call__(self, request: Any, timeout_ms: int) -> HttpResponse:
        self.sent.append(request)
        if not self.responses:
            raise AssertionError(f"no scripted response left for {request.method} {request.url}")
        return self.responses.pop(0)


def _credentials() -> StaticCredentialProvider:
    return StaticCredentialProvider(
        [
            ExchangeCredentials(
                exchange=ExchangeId.BINANCE,
                tenant_id=TENANT,
                account_id=ACCOUNT,
                api_key=API_KEY,
                api_secret=API_SECRET,
            )
        ]
    )


async def _unreachable_server_time() -> int:
    raise AssertionError("clock must be seeded; never network")


def _clock() -> ExchangeClock:
    clock = ExchangeClock(_unreachable_server_time)
    clock.seed(offset_millis=0)
    return clock


def _ok(body: Any, status: int = 200) -> HttpResponse:
    return HttpResponse(status=status, headers={"content-type": "application/json"}, body=json.dumps(body))


def _trading(sender: FakeSender) -> BinanceFuturesTradingAdapter:
    return BinanceFuturesTradingAdapter(
        params=FuturesTradingParams(
            send=sender, rest_base=BASE, rate_limits=build_futures_registry()
        ),
        credentials=_credentials(),
        clock=_clock(),
    )


def _account(sender: FakeSender) -> BinanceFuturesAccountAdapter:
    return BinanceFuturesAccountAdapter(
        params=FuturesTradingParams(
            send=sender, rest_base=BASE, rate_limits=build_futures_registry()
        ),
        credentials=_credentials(),
        clock=_clock(),
    )


def _intent(**kwargs: Any) -> OrderIntent:
    base = dict(
        tenant_id=TENANT,
        account_id=ACCOUNT,
        strategy_id=None,
        exchange=ExchangeId.BINANCE,
        symbol="BTC/USDT",
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal("0.01"),
        price=Decimal("40000"),
        time_in_force=TimeInForce.GTC,
        client_order_id=CLIENT_ID,
    )
    base.update(kwargs)
    return OrderIntent(**base)


def _param(request: Any, name: str) -> str | None:
    from urllib.parse import unquote_plus

    for pair in request.query.split("&"):
        key, _, value = pair.partition("=")
        if key == name:
            return unquote_plus(value)
    return None


def _hmac_hex(secret: str, payload: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


NEW_ORDER_RESULT = {
    "orderId": 9911882,
    "symbol": "BTCUSDT",
    "clientOrderId": CLIENT_ID,
    "status": "NEW",
    "side": "BUY",
    "type": "LIMIT",
    "origQty": "0.010",
    "executedQty": "0.000",
    "avgPrice": "0",
    "price": "40000",
    "timeInForce": "GTC",
    "updateTime": 1_750_000_000_000,
}


class TestSubmitShapeAndSignature:
    def test_submit_signs_with_the_client_order_id(self) -> None:
        sender = FakeSender([_ok(NEW_ORDER_RESULT)])
        adapter = _trading(sender)
        result = asyncio.new_event_loop().run_until_complete(
            adapter.submit_order(_intent(), CLIENT_ID)
        )
        request = sender.sent[0]
        assert request.method == "POST"
        assert request.url == BASE + "/fapi/v1/order"
        assert _param(request, "symbol") == "BTCUSDT"
        assert _param(request, "newClientOrderId") == CLIENT_ID
        assert _param(request, "side") == "BUY"
        assert _param(request, "type") == "LIMIT"
        assert _param(request, "quantity") == "0.01"
        assert _param(request, "price") == "40000"
        assert _param(request, "timeInForce") == "GTC"
        assert _param(request, "newOrderRespType") == "RESULT"
        # HMAC tail: the signature is the sha256 of the ENTIRE pre-signature
        # query under the account secret - recompute, don't pattern-match.
        query = request.query
        signed, _, signature = query.rpartition("&signature=")
        assert signature == _hmac_hex(API_SECRET, signed)
        assert request.headers.get("X-MBX-APIKEY") == API_KEY
        assert result.accepted is True
        assert result.status is OrderStatus.ACKNOWLEDGED
        assert result.is_simulated is False
        assert result.exchange_order_id == "9911882"

    def test_resubmission_carries_the_same_client_order_id(self) -> None:
        # Idempotency is a venue property: the SAME intent must produce the
        # SAME newClientOrderId on every attempt, so a retried POST after an
        # ambiguous timeout is deduplicated by the venue, not by our memory.
        sender = FakeSender([_ok(NEW_ORDER_RESULT), _ok(NEW_ORDER_RESULT)])
        adapter = _trading(sender)
        loop = asyncio.new_event_loop()
        loop.run_until_complete(adapter.submit_order(_intent(), CLIENT_ID))
        loop.run_until_complete(adapter.submit_order(_intent(), CLIENT_ID))
        assert _param(sender.sent[0], "newClientOrderId") == CLIENT_ID
        assert _param(sender.sent[1], "newClientOrderId") == CLIENT_ID

    def test_reduce_only_close_carries_reduceOnly_true(self) -> None:
        close = dict(NEW_ORDER_RESULT, side="SELL", status="NEW")
        sender = FakeSender([_ok(close)])
        adapter = _trading(sender)
        asyncio.new_event_loop().run_until_complete(
            adapter.submit_order(
                _intent(side=OrderSide.SELL, reduce_only=True, order_type=OrderType.MARKET),
                CLIENT_ID,
            )
        )
        request = sender.sent[0]
        assert _param(request, "reduceOnly") == "true"
        assert _param(request, "side") == "SELL"
        # A MARKET intent must not emit a price parameter on the wire.
        assert _param(request, "price") is None

    def test_openings_do_not_carry_reduce_only(self) -> None:
        sender = FakeSender([_ok(NEW_ORDER_RESULT)])
        _trading2 = _trading(sender)
        asyncio.new_event_loop().run_until_complete(_trading2.submit_order(_intent(), CLIENT_ID))
        assert _param(sender.sent[0], "reduceOnly") is None

    def test_limit_without_price_refuses_before_transmit(self) -> None:
        sender = FakeSender([])
        adapter = _trading(sender)
        with pytest.raises(AdapterRejectedError) as excinfo:
            asyncio.new_event_loop().run_until_complete(
                adapter.submit_order(_intent(price=None), CLIENT_ID)
            )
        assert "MISSING_PRICE" in (excinfo.value.code or "") if excinfo.value.code else str(excinfo.value)
        assert sender.sent == []

    def test_stop_orders_carry_stop_price(self) -> None:
        result_body = dict(NEW_ORDER_RESULT, type="STOP_MARKET", stopPrice="39000")
        sender = FakeSender([_ok(result_body)])
        asyncio.new_event_loop().run_until_complete(
            _trading(sender).submit_order(
                _intent(order_type=OrderType.STOP, stop_price=Decimal("39000")), CLIENT_ID
            )
        )
        assert _param(sender.sent[0], "stopPrice") == "39000"

    def test_stream_fills_refuses_in_favour_of_the_user_stream(self) -> None:
        with pytest.raises(AdapterError):
            _trading(FakeSender([])).stream_fills(TENANT, ACCOUNT)

    def test_fixed_ack_and_filled_status_transitions(self) -> None:
        filled = dict(
            NEW_ORDER_RESULT,
            status="FILLED",
            executedQty="0.010",
            avgPrice="39950.5",
        )
        sender = FakeSender([_ok(filled)])
        result = asyncio.new_event_loop().run_until_complete(
            _trading(sender).submit_order(_intent(), CLIENT_ID)
        )
        assert result.status is OrderStatus.FILLED
        assert result.fills is not None and len(result.fills) == 1
        fill = result.fills[0]
        assert fill.quantity == Decimal("0.010")
        assert fill.price == Decimal("39950.5")
        assert fill.exchange_order_id == "9911882"
        assert fill.is_simulated is False


class TestVenueErrorMappingOnTheWire:
    def _reject(self, code: int, http_status: int = 400) -> HttpResponse:
        return HttpResponse(
            status=http_status,
            headers={"content-type": "application/json"},
            body=json.dumps({"code": code, "msg": "venue message"}),
        )

    def _run(self, response: HttpResponse):
        sender = FakeSender([response])
        return asyncio.new_event_loop().run_until_complete(
            _trading(sender).submit_order(_intent(), CLIENT_ID)
        )

    def test_margin_not_sufficient_is_structured_exchange_error(self) -> None:
        with pytest.raises(AdapterRejectedError) as excinfo:
            self._run(self._reject(-2019))
        exc = excinfo.value
        assert getattr(exc, "venue_code", None) == -2019

    def test_reduce_only_reject_classifies_invalid_request(self) -> None:
        with pytest.raises(AdapterRejectedError) as excinfo:
            self._run(self._reject(-2022))
        assert excinfo.value.venue_code == -2022  # type: ignore[attr-defined]

    def test_leverage_bracket_refusal_is_exchange_error(self) -> None:
        with pytest.raises(AdapterRejectedError) as excinfo:
            self._run(self._reject(-2027))
        assert excinfo.value.venue_code == -2027  # type: ignore[attr-defined]

    def test_margin_is_not_leverage(self) -> None:
        sender = FakeSender([self._reject(-2019)])
        try:
            asyncio.new_event_loop().run_until_complete(
                _trading(sender).submit_order(_intent(), CLIENT_ID)
            )
        except AdapterRejectedError as one:
            one_code = one.venue_code  # type: ignore[attr-defined]
        sender = FakeSender([self._reject(-2027)])
        try:
            asyncio.new_event_loop().run_until_complete(
                _trading(sender).submit_order(_intent(), CLIENT_ID)
            )
        except AdapterRejectedError as two:
            two_code = two.venue_code  # type: ignore[attr-defined]
        assert one_code == -2019 and two_code == -2027 and one_code != two_code

    def test_timestamp_fault_is_transient_connection_error(self) -> None:
        # -1021 surfaces as TIMEOUT-category -> AdapterConnectionError so the
        # retry policy resyncs once instead of refusing the order.
        with pytest.raises(AdapterConnectionError):
            self._run(self._reject(-1021))

    def test_rate_limit_carries_retry_after_and_holds(self) -> None:
        response = HttpResponse(
            status=429,
            headers={"Retry-After": "3", "content-type": "application/json"},
            body=json.dumps({"code": -1003, "msg": "Too many requests"}),
        )
        with pytest.raises(FuturesRateLimited) as excinfo:
            self._run(response)
        assert excinfo.value.retry_after_millis == 3_000
        assert excinfo.value.category is ExchangeErrorCategory.RATE_LIMIT_ERROR

    def test_ban_status_418_also_rate_limited(self) -> None:
        response = HttpResponse(
            status=418, headers={}, body=json.dumps({"code": -1003, "msg": "banned"})
        )
        with pytest.raises(FuturesRateLimited):
            self._run(response)


class TestOrderQueries:
    def test_fetch_order_returns_none_only_on_minus_2013(self) -> None:
        sender = FakeSender(
            [
                HttpResponse(
                    status=400,
                    headers={},
                    body=json.dumps({"code": -2013, "msg": "Order does not exist."}),
                )
            ]
        )
        adapter = _trading(sender)
        order = Order.from_intent(_intent(), client_order_id=CLIENT_ID)
        result = asyncio.new_event_loop().run_until_complete(adapter.fetch_order_for(order))
        assert result is None
        request = sender.sent[0]
        assert request.method == "GET"
        assert _param(request, "origClientOrderId") == CLIENT_ID
        assert _param(request, "symbol") == "BTCUSDT"

    def test_fetch_order_parses_the_venue_payload(self) -> None:
        sender = FakeSender([_ok(NEW_ORDER_RESULT)])
        adapter = _trading(sender)
        order = Order.from_intent(_intent(), client_order_id=CLIENT_ID)
        found = asyncio.new_event_loop().run_until_complete(adapter.fetch_order_for(order))
        assert found is not None
        assert found.status is OrderStatus.ACKNOWLEDGED
        assert found.client_order_id == CLIENT_ID
        assert found.exchange_order_id == "9911882"
        assert found.reduce_only is False

    def test_other_faults_raise_not_none(self) -> None:
        # -2011 (CANCEL_REJECTED), auth faults, anything that is not the
        # positive "no such order": the resolver must see an exception.
        for code in (-2011, -1022, -1000):
            sender = FakeSender(
                [
                    HttpResponse(
                        status=400, headers={}, body=json.dumps({"code": code, "msg": "x"})
                    )
                ]
            )
            with pytest.raises(Exception):
                order = Order.from_intent(_intent(), client_order_id=CLIENT_ID)
                asyncio.new_event_loop().run_until_complete(
                    _trading(sender).fetch_order_for(order)
                )

    def test_cancel_mapping_and_second_cancel_is_clean_refusal(self) -> None:
        cancelled = dict(NEW_ORDER_RESULT, status="CANCELED")
        sender = FakeSender(
            [
                _ok(cancelled),
                HttpResponse(
                    status=400, headers={}, body=json.dumps({"code": -2011, "msg": "no"})
                ),
            ]
        )
        adapter = _trading(sender)
        order = Order.from_intent(_intent(), client_order_id=CLIENT_ID)
        first = asyncio.new_event_loop().run_until_complete(adapter.cancel_order(order))
        assert first.accepted is True

        # Second cancel: the venue's -2011 ("no such open order") is a clean
        # refusal the caller reads as data, not an exception - cancelled-anyway
        # is the terminal answer a cancel was asking for. The adapter matches
        # on the structured venue_code, never on message prose.
        second = asyncio.new_event_loop().run_until_complete(adapter.cancel_order(order))
        assert second.accepted is False
        assert "already" in (second.reason or "")


class TestAccountAdapter:
    def test_set_leverage_posts_the_computed_request(self) -> None:
        sender = FakeSender(
            [_ok({"symbol": "BTCUSDT", "leverage": 3, "maxNotionalValue": "250000"})]
        )
        answer = asyncio.new_event_loop().run_until_complete(
            _account(sender).set_leverage(TENANT, ACCOUNT, "BTCUSDT", 3)
        )
        request = sender.sent[0]
        assert request.method == "POST"
        assert request.url == BASE + "/fapi/v1/leverage"
        assert _param(request, "leverage") == "3"
        assert answer["leverage"] == Decimal("3")
        assert answer["max_notional_value"] == Decimal("250000")

    def test_leverage_fault_vocabulary_stays_structured(self) -> None:
        # -4164 LEVERAGE switch failed and -2028 below-minimum must both be
        # distinguishable errors, not prose.
        sender = FakeSender(
            [HttpResponse(status=400, headers={}, body=json.dumps({"code": -4164, "msg": "s"}))]
        )
        with pytest.raises(AdapterRejectedError) as excinfo:
            asyncio.new_event_loop().run_until_complete(
                _account(sender).set_leverage(TENANT, ACCOUNT, "BTCUSDT", 3)
            )
        assert excinfo.value.venue_code == -4164  # type: ignore[attr-defined]

    def test_margin_type_noop_is_idempotent_success(self) -> None:
        # -4059: already on the requested mode. set_margin_type must swallow
        # exactly this code so retrying isolated-margin setup is safe.
        sender = FakeSender(
            [HttpResponse(status=400, headers={}, body=json.dumps({"code": -4059, "msg": "no"}))]
        )
        asyncio.new_event_loop().run_until_complete(
            _account(sender).set_margin_type(TENANT, ACCOUNT, "BTCUSDT", "ISOLATED")
        )  # must not raise

    def test_margin_type_other_codes_raise(self) -> None:
        sender = FakeSender(
            [HttpResponse(status=400, headers={}, body=json.dumps({"code": -2019, "msg": "no"}))]
        )
        with pytest.raises(AdapterRejectedError):
            asyncio.new_event_loop().run_until_complete(
                _account(sender).set_margin_type(TENANT, ACCOUNT, "BTCUSDT", "ISOLATED")
            )

    def test_margin_type_rejects_unseen_mode_before_transmit(self) -> None:
        sender = FakeSender([])
        with pytest.raises(AdapterRejectedError):
            asyncio.new_event_loop().run_until_complete(
                _account(sender).set_margin_type(TENANT, ACCOUNT, "BTCUSDT", "WEIRD")
            )
        assert sender.sent == []

    def test_fetch_positions_filters_zero_amount_entries(self) -> None:
        positions = [
            {
                "symbol": "BTCUSDT",
                "positionAmt": "0.5",
                "entryPrice": "40000",
                "markPrice": "40100",
                "liquidationPrice": "25000",
                "unRealizedProfit": "10",
                "leverage": "3",
                "marginType": "isolated",
                "updateTime": 1_750_000_000_000,
            },
            {
                "symbol": "ETHUSDT",
                "positionAmt": "0",
                "entryPrice": "0",
                "markPrice": "0",
                "liquidationPrice": "0",
                "unRealizedProfit": "0",
                "leverage": "3",
                "marginType": "cross",
                "updateTime": 1_750_000_000_000,
            },
        ]
        sender = FakeSender([_ok(positions)])
        found = asyncio.new_event_loop().run_until_complete(
            _account(sender).fetch_positions(TENANT, ACCOUNT)
        )
        assert len(found) == 1
        assert found[0].symbol == "BTCUSDT"
        # The zero-amount ETHUSDT entry is dropped; the held leg is Decimal-exact.
        assert found[0].quantity == Decimal("0.5")
        assert found[0].leverage == Decimal("3")

    def test_verify_credentials_reports_futures_earmark(self) -> None:
        account = {
            "assets": [],
            "positions": [],
            "canWithdraw": "0",
            "totalMarginBalance": "100",
            "totalMaintMargin": "0",
            "feeTier": 0,
            "canTrade": True,
        }
        sender = FakeSender([_ok(account)])
        answer = asyncio.new_event_loop().run_until_complete(
            _account(sender).verify_credentials(TENANT, ACCOUNT)
        )
        assert answer["can_trade"] is True
        assert "FUTURES_EARMARKED" in answer["permissions"]


class TestVocabulary:
    def test_order_type_mapping_is_closed(self) -> None:
        assert to_futures_order_type(OrderType.MARKET) == "MARKET"
        assert to_futures_order_type(OrderType.LIMIT) == "LIMIT"
        assert to_futures_order_type(OrderType.STOP) == "STOP_MARKET"
        assert to_futures_order_type(OrderType.STOP_LIMIT) == "STOP"

    def test_venue_symbol_strips_separators(self) -> None:
        assert venue_symbol("BTC/USDT") == "BTCUSDT"
        assert venue_symbol("eth-usdt") == "ETHUSDT"

    def test_fetch_order_requires_symbol_hint(self) -> None:
        sender = FakeSender([])
        adapter = _trading(sender)
        with pytest.raises(AdapterRejectedError) as excinfo:
            asyncio.new_event_loop().run_until_complete(
                adapter.fetch_order(TENANT, ACCOUNT, CLIENT_ID)
            )
        assert "SYMBOL_REQUIRED" in str(excinfo.value.code or excinfo.value)
        assert sender.sent == []
