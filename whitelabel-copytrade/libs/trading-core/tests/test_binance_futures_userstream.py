"""Batch 03 futures tests: the USD-M private user-data stream.

The properties pinned here are custody properties, not parsing conveniences:

- the listen key never leaves the manager in plaintext - callers get the
  stream URL and a masked diagnostic form only;
- keepalive rides the keyed PUT, reopen rides DELETE, and a failed renewal is
  recorded rather than raised (the stream must survive one blip);
- ``listenKeyExpired`` invalidates the local key without a venue call - the
  venue already killed it, and a close call would be a wasted request;
- ACCOUNT_UPDATE and ORDER_TRADE_UPDATE frames parse total; protocol
  violations raise so the socket loop resyncs instead of corrupting state.
"""

from __future__ import annotations

import asyncio
import json
from decimal import Decimal
from typing import Any

import pytest

from wlct_trading.adapters.base import AdapterError
from wlct_trading.enums import OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.exchanges.binance_futures.parsers import FuturesParseError
from wlct_trading.exchanges.binance_futures.userstream import (
    FuturesListenKeyClient,
    FuturesUserStream,
    parse_account_update,
    parse_futures_execution_report,
)

TENANT = "tenant-futures-ws"
ACCOUNT = "acct-futures-ws"
LISTEN_KEY = "listen" + "key" + "000000000000" + "futures"


class FakeKeyed:
    """Captures every keyed REST call the listen-key client would make."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.responses: list[Any] = []
        self.fail_next: Exception | None = None

    async def __call__(self, **kwargs: Any) -> Any:
        if self.fail_next is not None:
            exc, self.fail_next = self.fail_next, None
            raise exc
        self.calls.append(kwargs)
        if self.responses:
            return self.responses.pop(0)
        return {}


def _stream(keyed: FakeKeyed, **kwargs: Any) -> FuturesUserStream:
    return FuturesUserStream(
        keyed_client=FuturesListenKeyClient(keyed=keyed),
        tenant_id=TENANT,
        account_id=ACCOUNT,
        testnet=False,
        **kwargs,
    )


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class TestListenKeyLifecycle:
    def test_create_returns_the_key_and_posts_keyed(self) -> None:
        keyed = FakeKeyed()
        keyed.responses.append({"listenKey": LISTEN_KEY})
        client = FuturesListenKeyClient(keyed=keyed)
        key = run(client.create(tenant_id=TENANT, account_id=ACCOUNT))
        assert key == LISTEN_KEY
        call = keyed.calls[0]
        assert call["method"] == "POST"
        assert call["path"] == "/fapi/v1/listenKey"
        assert call["weight"] == 1

    def test_create_without_key_payload_raises(self) -> None:
        keyed = FakeKeyed()
        keyed.responses.append({})
        client = FuturesListenKeyClient(keyed=keyed)
        with pytest.raises(AdapterError):
            run(client.create(tenant_id=TENANT, account_id=ACCOUNT))

    def test_acquire_returns_a_url_never_the_key(self) -> None:
        keyed = FakeKeyed()
        keyed.responses.append({"listenKey": LISTEN_KEY})
        stream = _stream(keyed)
        url = run(stream.acquire())
        assert url == f"wss://fstream.binance.com/ws/{LISTEN_KEY}"
        # repr of the stream/manager must not contain the raw key.
        assert LISTEN_KEY not in repr(stream.key_manager.status())

    def test_renewal_is_recorded_and_never_raised(self) -> None:
        keyed = FakeKeyed()
        keyed.responses.append({"listenKey": LISTEN_KEY})
        stream = _stream(keyed)
        run(stream.acquire())

        # Blip: renew returns False, counts the failure, does not raise.
        keyed.fail_next = RuntimeError("venue hiccup")
        assert run(stream.renew()) is False
        assert stream.key_manager.renewal_failures == 1

        # Recovery: a successful keepalive resets the failure count.
        assert run(stream.renew()) is True
        assert stream.key_manager.renewal_count == 1
        assert stream.key_manager.renewal_failures == 0
        keepalive_call = keyed.calls[-1]
        assert keepalive_call["method"] == "PUT"
        assert ("listenKey", LISTEN_KEY) in keepalive_call["params"]

    def test_renew_without_key_is_false_not_an_exception(self) -> None:
        keyed = FakeKeyed()
        stream = _stream(keyed)
        assert run(stream.renew()) is False

    def test_release_closes_and_forgets_even_if_the_close_fails(self) -> None:
        keyed = FakeKeyed()
        keyed.responses.append({"listenKey": LISTEN_KEY})
        stream = _stream(keyed)
        run(stream.acquire())
        keyed.fail_next = RuntimeError("venue gone")
        run(stream.release())  # must not raise
        assert stream.key_manager.has_key is False

    def test_listenkey_expired_invalidates_without_a_close_call(self) -> None:
        keyed = FakeKeyed()
        keyed.responses.append({"listenKey": LISTEN_KEY})
        stream = _stream(keyed)
        run(stream.acquire())
        calls_before = len(keyed.calls)
        frame = json.dumps({"e": "listenKeyExpired", "E": 1_750_000_000_000})
        event = stream.handle_frame(frame)
        assert event == {"kind": "listen_key_expired"}
        assert stream.key_manager.has_key is False
        # No PUT/DELETE was issued for the dead key.
        assert len(keyed.calls) == calls_before

    def test_reconnect_after_expiry_creates_a_fresh_key(self) -> None:
        keyed = FakeKeyed()
        keyed.responses.append({"listenKey": LISTEN_KEY})
        stream = _stream(keyed)
        run(stream.acquire())
        stream.handle_frame(json.dumps({"e": "listenKeyExpired"}))
        keyed.responses.append({"listenKey": "fresh" + "key" + "00000000"})
        url = run(stream.acquire())
        assert "/ws/freshkey00000000" in url


class TestFrameDecoding:
    EXECUTION_FRAME = {
        "e": "ORDER_TRADE_UPDATE",
        "E": 1_750_000_000_000,
        "T": 1_750_000_000_000,
        "o": {
            "s": "BTCUSDT",
            "c": "wlct-fut-1",
            "i": 99887766,
            "S": "BUY",
            "o": "LIMIT",
            "f": "GTC",
            "x": "PARTIALLY_FILLED",
            "q": "0.010",
            "z": "0.004",
            "l": "0.004",
            "L": "39950.25",
            "ap": "39950.25",
            "n": "0.0160",
            "N": "USDT",
            "t": 445566,
            "m": False,
            "T": 1_750_000_000_000,
            "R": False,
        },
    }

    def test_execution_report_parses_all_decimal_fields(self) -> None:
        report = parse_futures_execution_report(self.EXECUTION_FRAME)
        assert report["symbol"] == "BTCUSDT"
        assert report["client_order_id"] == "wlct-fut-1"
        assert report["side"] is OrderSide.BUY
        assert report["order_type"] is OrderType.LIMIT
        assert report["time_in_force"] is TimeInForce.GTC
        assert report["status"] is OrderStatus.PARTIALLY_FILLED
        assert report["cumulative_filled_quantity"] == Decimal("0.004")
        assert report["last_executed_quantity"] == Decimal("0.004")
        assert report["last_executed_price"] == Decimal("39950.25")
        assert report["average_price"] == Decimal("39950.25")
        assert report["commission"] == Decimal("0.0160")
        assert report["commission_asset"] == "USDT"
        assert report["trade_id"] == 445566
        assert report["reduce_only"] is False

    def test_new_or_canceled_reports_are_never_mistaken_for_fills(self) -> None:
        for status in ("NEW", "CANCELED", "EXPIRED", "REJECTED"):
            frame = json.loads(json.dumps(self.EXECUTION_FRAME))
            frame["o"]["x"] = status
            frame["o"]["z"] = "0"
            report = parse_futures_execution_report(frame)
            # The average-price slot is None when nothing executed - the
            # reconciler must not treat an acknowledgement as a partial fill.
            assert report["average_price"] is None
            assert report["cumulative_filled_quantity"] == Decimal("0")

    def test_out_of_order_and_duplicate_frames_carry_stable_ids(self) -> None:
        # Dedup happens in the engine, but the frame carries the venue's own
        # (order id, trade id) pair so a redelivered trade remains one trade:
        # out-of-order arrival must not change which truth the ledger sees.
        late = parse_futures_execution_report(self.EXECUTION_FRAME)
        early_status = json.loads(json.dumps(self.EXECUTION_FRAME))
        early_status["o"]["x"] = "NEW"
        early_status["o"]["z"] = "0"
        early_status["o"]["t"] = 0
        early = parse_futures_execution_report(early_status)
        assert late["venue_order_id"] == early["venue_order_id"] == "99887766"

    def test_account_update_splits_balances_and_nonzero_positions(self) -> None:
        frame = {
            "e": "ACCOUNT_UPDATE",
            "E": 1_750_000_000_000,
            "T": 1_750_000_000_000,
            "a": {
                "m": "ORDER",
                "B": [{"a": "USDT", "wb": "1000.0", "cw": "1000.0", "bc": "0"}],
                "P": [
                    {
                        "s": "BTCUSDT",
                        "pa": "0.5",
                        "ep": "40000",
                        "up": "50.25",
                        "mt": "isolated",
                    },
                    {"s": "ETHUSDT", "pa": "0", "ep": "0", "up": "0", "mt": "cross"},
                ],
            },
        }
        update = parse_account_update(frame)
        assert update["reason"] == "ORDER"
        assert update["balances"][0]["wallet_balance"] == Decimal("1000.0")
        assert len(update["positions"]) == 1
        assert update["positions"][0]["symbol"] == "BTCUSDT"
        assert update["positions"][0]["position_amt"] == Decimal("0.5")

    def test_frame_router_kinds(self) -> None:
        keyed = FakeKeyed()
        stream = _stream(keyed)
        report = stream.handle_frame(json.dumps(self.EXECUTION_FRAME))
        assert report is not None and report["kind"] == "execution_report"
        update = stream.handle_frame(
            json.dumps({"e": "ACCOUNT_UPDATE", "a": {"B": [], "P": [], "m": "ORDER"}})
        )
        assert update is not None and update["kind"] == "account_update"
        # Control frames (subscribe ACK, pong) decode to None intentionally.
        assert stream.handle_frame(json.dumps({"result": None, "id": 1})) is None
        # Other documented venue frames pass through untyped for the router.
        passthrough = stream.handle_frame(json.dumps({"e": "MARGIN_CALL", "E": 1}))
        assert passthrough is not None
        assert passthrough["kind"] == "passthrough"
        assert passthrough["event_type"] == "MARGIN_CALL"

    def test_protocol_violations_raise_not_swallow(self) -> None:
        keyed = FakeKeyed()
        stream = _stream(keyed)
        with pytest.raises(FuturesParseError):
            stream.handle_frame("not json {")
        with pytest.raises(FuturesParseError):
            stream.handle_frame(json.dumps([1, 2, 3]))
        with pytest.raises(FuturesParseError):
            stream.handle_frame(json.dumps({"e": "ORDER_TRADE_UPDATE"}))  # no 'o'
