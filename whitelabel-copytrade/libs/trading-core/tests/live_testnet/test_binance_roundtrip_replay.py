# Replays the recorded Binance testnet round trip under the conditions that decide money: duplicates, unknown orders, ambiguous polls, a process restart, and a fill arriving on the user stream.
"""Deterministic replay of the recorded Binance testnet round trip.

``test_binance_testnet_roundtrip.py`` proves the happy path exists. This file
proves the parts that decide whether the platform can be trusted with money, by
replaying the SAME recording under the states the happy path never shows:

  DUPLICATE   the venue refuses a second order carrying the same client order id
              (``-2010 Duplicate order sent``). The platform must read that as a
              definitive refusal AND as evidence that the first order exists.
  UNKNOWN     a query for an order the venue has never seen (``-2013``) is the
              ONLY case that means "it is not there".
  AMBIGUOUS   a 5xx or a socket timeout during a poll is "I could not ask" and
              must never be collapsed into "it is not there" - that collapse is
              how a live order becomes an orphan position.
  RESTART     a fresh adapter holds no symbol hint, and Binance requires the
              symbol to address an order by client id. The replay proves the
              adapter refuses to guess, and that a hint seeded from the durable
              record makes the same query work.
  FILL        a ``TRADE`` execution report on the user stream is a fill; the
              ``NEW`` and ``CANCELED`` reports in the same recording are not, and
              booking one as a fill would invent a trade at price zero.

Everything here is offline and credential-free: the venue's bytes are the
recording, and every assertion is about what the platform derives from them.
"""

from __future__ import annotations

import asyncio
import copy
import json
from decimal import Decimal
from typing import Any, Callable, Mapping

import pytest

from wlct_trading.adapters.base import (
    AdapterConnectionError,
    AdapterError,
    AdapterRejectedError,
)
from wlct_trading.enums import (
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.exchanges.binance.capabilities import BINANCE_TESTNET_REST_BASE
from wlct_trading.exchanges.binance.trading import HttpResponse
from wlct_trading.exchanges.binance.userstream import (
    parse_user_stream_message,
)
from wlct_trading.orders import Order, OrderIntent

TENANT = "tenant-live-proof"
ACCOUNT = "acct-testnet-proof"
SYMBOL = "BTC-USDT"
CLIENT_ORDER_ID = "wlct-testnet-proof-0001"


def intent_and_client_id() -> tuple[OrderIntent, str]:
    """The intent the recording was made with, rebuilt from the fixture's values."""
    return (
        OrderIntent(
            tenant_id=TENANT,
            account_id=ACCOUNT,
            strategy_id=None,
            exchange=ExchangeId.BINANCE,
            symbol=SYMBOL,
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            quantity=Decimal("0.00100000"),
            price=Decimal("20000.00000000"),
            time_in_force=TimeInForce.GTC,
            client_order_id=CLIENT_ORDER_ID,
        ),
        CLIENT_ORDER_ID,
    )


def local_order() -> Order:
    return Order(
        order_id="order-local-0001",
        client_order_id=CLIENT_ORDER_ID,
        tenant_id=TENANT,
        account_id=ACCOUNT,
        strategy_id=None,
        exchange=ExchangeId.BINANCE,
        symbol=SYMBOL,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal("0.00100000"),
        price=Decimal("20000.00000000"),
        status=OrderStatus.ACKNOWLEDGED,
        exchange_order_id="7745219",
    )


def response(status: int, body: Mapping[str, Any]) -> HttpResponse:
    return HttpResponse(status=status, headers={}, body=json.dumps(body))


# ======================================================================
# Determinism
# ======================================================================
class TestTheReplayIsDeterministic:
    """Two runs of the same bytes must produce the same answers."""

    def test_the_same_recording_produces_the_same_result_twice(
        self, make_recording: Callable[..., Any]
    ) -> None:
        results = []
        for _ in range(2):
            trading, _, _ = make_recording("submit")
            intent, client_order_id = intent_and_client_id()
            results.append(
                asyncio.run(trading.submit_order(intent, client_order_id))
            )

        first, second = results
        assert first.exchange_order_id == second.exchange_order_id
        assert first.status is second.status
        assert first.accepted is second.accepted
        assert first.submitted_at_micros == second.submitted_at_micros
        assert first.is_simulated is second.is_simulated is False

    def test_the_venue_timestamp_is_used_rather_than_the_local_clock(
        self, make_recording: Callable[..., Any]
    ) -> None:
        """``submitted_at_micros`` comes from ``transactTime``.

        A local-clock substitute would make the platform's record of *when* an
        order was placed differ from the venue's, which is exactly the field an
        incident review checks first.
        """
        trading, _, _ = make_recording("submit")
        intent, client_order_id = intent_and_client_id()

        submitted = asyncio.run(trading.submit_order(intent, client_order_id))

        assert submitted.submitted_at_micros == 1_760_951_641_320_000

    def test_the_account_snapshot_decimals_are_exact(
        self, make_recording: Callable[..., Any]
    ) -> None:
        _, account, _ = make_recording("account")

        first = asyncio.run(account.fetch_account(TENANT, ACCOUNT))

        assert {b.asset: b.free for b in first.balances}["USDT"] == Decimal("5000.00000000")
        # Trailing zeroes survive: the value is compared, the wire text is kept.
        assert str(first.balances[1].free) == "5000.00000000"
        assert first.maker_commission_bps is not None


# ======================================================================
# Duplicates
# ======================================================================
class TestDuplicateSubmission:
    """A second order with the same client id is a refusal and evidence."""

    def test_the_venue_duplicate_refusal_is_definitive_and_names_the_order(
        self, make_recording: Callable[..., Any]
    ) -> None:
        trading, _, sender = make_recording()

        sender.hook = lambda request: response(
            400, {"code": -2010, "msg": "Duplicate order sent."}
        )
        intent, client_order_id = intent_and_client_id()

        with pytest.raises(AdapterRejectedError) as excinfo:
            asyncio.run(trading.submit_order(intent, client_order_id))

        assert excinfo.value.code == "-2010"
        assert "duplicate" in str(excinfo.value).lower()
        # The request that was refused still carried the deterministic id, which
        # is what makes "duplicate" a safe thing to conclude: it is OUR order.
        assert "newClientOrderId=wlct-testnet-proof-0001" in sender.query_of(0)

    def test_a_duplicate_is_never_reconciled_as_an_ambiguous_failure(
        self, make_recording: Callable[..., Any]
    ) -> None:
        """The distinction in one assertion.

        ``-2010`` is definitive: the venue processed the request and said no. It
        must not be raised as an ambiguous error, because the engine reacts to
        ambiguity by reconciling, and reconciling a duplicate would adopt the
        first order's state onto the second attempt's record.
        """
        trading, _, sender = make_recording()
        sender.hook = lambda request: response(
            400, {"code": -2010, "msg": "Duplicate order sent."}
        )
        intent, client_order_id = intent_and_client_id()

        with pytest.raises(AdapterRejectedError) as excinfo:
            asyncio.run(trading.submit_order(intent, client_order_id))

        # The two exception classes ARE the classification: the engine dispatches
        # on them, so asserting the class is the whole assertion.
        assert not isinstance(excinfo.value, AdapterConnectionError)
        assert isinstance(excinfo.value, AdapterError)
        assert excinfo.value.code == "-2010"


# ======================================================================
# Unknown vs ambiguous
# ======================================================================
class TestUnknownVersusAmbiguous:
    """The single most dangerous pair of outcomes to conflate."""

    def test_a_venue_2013_is_the_only_absent_answer(
        self, make_recording: Callable[..., Any]
    ) -> None:
        trading, _, sender = make_recording()
        sender.hook = lambda request: response(
            400, {"code": -2013, "msg": "Order does not exist."}
        )

        assert asyncio.run(trading.fetch_order_for(local_order())) is None

    def test_a_5xx_during_a_poll_raises_instead_of_returning_absent(
        self, make_recording: Callable[..., Any]
    ) -> None:
        trading, _, sender = make_recording()
        sender.hook = lambda request: response(503, {"msg": "Service Unavailable"})

        with pytest.raises(AdapterConnectionError) as excinfo:
            asyncio.run(trading.fetch_order_for(local_order()))
        assert "unknown" in str(excinfo.value).lower()

    def test_a_socket_timeout_during_a_poll_raises_instead_of_returning_absent(
        self, make_recording: Callable[..., Any]
    ) -> None:
        trading, _, sender = make_recording()

        def hook(request: Any) -> HttpResponse:
            raise TimeoutError("read timed out")

        sender.hook = hook

        with pytest.raises(AdapterConnectionError):
            asyncio.run(trading.fetch_order_for(local_order()))

    def test_an_unrecognised_status_is_refused_rather_than_guessed(
        self, make_recording: Callable[..., Any]
    ) -> None:
        """A status vocabulary the platform does not know is a parse failure.

        Defaulting to FILLED would book a position; defaulting to NEW would hide a
        completed one. Both are worse than an error an operator can see.
        """
        trading, _, sender = make_recording()
        sender.hook = lambda request: response(
            200,
            {
                "symbol": "BTCUSDT",
                "orderId": "7745219",
                "clientOrderId": CLIENT_ORDER_ID,
                "price": "20000.00000000",
                "origQty": "0.00100000",
                "executedQty": "0.00000000",
                "status": "SOME_NEW_VENUE_STATE",
                "timeInForce": "GTC",
                "type": "LIMIT",
                "side": "BUY",
                "time": "1760951641320",
                "updateTime": "1760951641320",
            },
        )

        with pytest.raises(Exception) as excinfo:
            asyncio.run(trading.fetch_order_for(local_order()))
        assert "unrecognised" in str(excinfo.value).lower() or "refus" in str(excinfo.value).lower()


# ======================================================================
# Restart
# ======================================================================
class TestRestartReplay:
    """A process that restarts loses its in-memory symbol hints, not the order."""

    def test_a_fresh_adapter_refuses_to_guess_the_symbol(
        self, make_recording: Callable[..., Any]
    ) -> None:
        trading, _, _ = make_recording("poll")

        with pytest.raises(AdapterError) as excinfo:
            asyncio.run(trading.fetch_order(TENANT, ACCOUNT, CLIENT_ORDER_ID))
        assert "register_symbol_hint" in str(excinfo.value)

    def test_a_seeded_hint_from_the_durable_record_makes_the_query_work(
        self, make_recording: Callable[..., Any]
    ) -> None:
        """The restart path the reconciliation job uses."""
        trading, _, sender = make_recording("poll")
        trading.register_symbol_hint(CLIENT_ORDER_ID, SYMBOL)

        recovered = asyncio.run(trading.fetch_order(TENANT, ACCOUNT, CLIENT_ORDER_ID))

        assert recovered is not None
        assert recovered.status is OrderStatus.ACKNOWLEDGED
        assert sender.param(0, "symbol") == "BTCUSDT"
        assert sender.param(0, "origClientOrderId") == CLIENT_ORDER_ID

    def test_the_hint_map_is_bounded(self, make_recording: Callable[..., Any]) -> None:
        """Ten thousand entries, then a reset - a long-lived adapter is not a leak."""
        trading, _, _ = make_recording()
        for index in range(10_000):
            trading.register_symbol_hint(f"client-{index}", SYMBOL)
        trading.register_symbol_hint("one-more", SYMBOL)

        assert len(trading._symbol_hints) == 1  # noqa: SLF001 - the bound is the assertion
        assert trading._symbol_hints["one-more"] == SYMBOL  # noqa: SLF001


# ======================================================================
# Fills on the user stream
# ======================================================================
class TestUserStreamFillReplay:
    """``NEW`` and ``CANCELED`` are lifecycle; only ``TRADE`` is money."""

    @staticmethod
    def _trade_event(recording: Mapping[str, Any]) -> dict[str, Any]:
        """The recorded NEW event, rewritten into a partial fill at the same price."""
        event = copy.deepcopy(recording["userStream"][0]["events"][0])
        event.update(
            {
                "x": "TRADE",
                "X": "PARTIALLY_FILLED",
                "l": "0.00040000",
                "z": "0.00040000",
                "L": "20000.00000000",
                "n": "0.00800000",
                "N": "USDT",
                "t": "99117",
                "m": False,
                "Z": "8.00000000",
                "Y": "0.00800000",
                "T": "1760951645000",
                "E": "1760951645005",
                "W": "1760951645000",
            }
        )
        return event

    def test_a_trade_report_is_a_fill_with_exact_decimals(
        self, recording: Mapping[str, Any]
    ) -> None:
        event = parse_user_stream_message(json.dumps(self._trade_event(recording)))

        assert event.execution is not None
        assert event.execution.is_trade is True
        assert event.execution.status is OrderStatus.PARTIALLY_FILLED
        assert event.execution.last_filled_quantity == Decimal("0.00040000")
        assert event.execution.last_filled_price == Decimal("20000.00000000")
        assert event.execution.cumulative_filled_quantity == Decimal("0.00040000")
        assert event.execution.commission == Decimal("0.00800000")
        assert event.execution.commission_asset == "USDT"
        assert event.execution.trade_id == "99117"
        assert event.execution.is_maker is False

    def test_the_recorded_lifecycle_events_are_never_fills(
        self, recording: Mapping[str, Any]
    ) -> None:
        for raw in recording["userStream"][0]["events"]:
            event = parse_user_stream_message(json.dumps(raw))
            assert event.execution is not None
            assert event.execution.is_trade is False
            assert event.execution.last_filled_quantity == Decimal("0")

    def test_a_cancel_report_keeps_the_original_client_id_apart(
        self, recording: Mapping[str, Any]
    ) -> None:
        """The protocol quirk this platform had to contain.

        On a cancellation ``c`` is the *cancel request's* id and ``C`` is the
        order being cancelled. Reading them the wrong way round would attach the
        cancellation to an order that does not exist.
        """
        event = copy.deepcopy(recording["userStream"][0]["events"][1])
        event.update({"c": "wlct-cancel-request-0001", "C": CLIENT_ORDER_ID})

        parsed = parse_user_stream_message(json.dumps(event))

        assert parsed.execution is not None
        assert parsed.execution.client_order_id == "wlct-cancel-request-0001"
        assert parsed.execution.original_client_order_id == CLIENT_ORDER_ID
        assert parsed.execution.status is OrderStatus.CANCELLED

    def test_an_empty_original_id_is_none_and_not_an_empty_string(
        self, recording: Mapping[str, Any]
    ) -> None:
        raw = copy.deepcopy(recording["userStream"][0]["events"][0])
        raw["C"] = ""

        parsed = parse_user_stream_message(json.dumps(raw))

        assert parsed.execution is not None
        assert parsed.execution.original_client_order_id is None

    def test_a_listen_key_expiry_is_its_own_event(
        self, recording: Mapping[str, Any]
    ) -> None:
        """Expiry is not a reconnect: the key is dead and must be re-created."""
        raw = {"e": "listenKeyExpired", "E": "1760952000000"}

        parsed = parse_user_stream_message(json.dumps(raw))

        assert parsed.expiry is not None
        assert parsed.execution is None
        assert parsed.expiry.event_time_micros == 1_760_952_000_000_000
        assert recording["userStream"][0]["listenKey"].startswith("testnet-listen-key")

    def test_the_listen_key_never_appears_unmasked_in_a_rendering(
        self, recording: Mapping[str, Any]
    ) -> None:
        from wlct_trading.exchanges.binance.userstream import mask_listen_key

        listen_key = recording["userStream"][0]["listenKey"]
        masked = mask_listen_key(listen_key)

        assert masked != listen_key
        assert listen_key[-4:] in masked or "…" in masked or "*" in masked
        assert len(masked) <= len(listen_key)


# ======================================================================
# The stream vocabulary is the testnet one
# ======================================================================
class TestTheRecordingMatchesTheTestnetContract:
    def test_the_rest_base_used_by_the_replay_is_the_testnet(
        self, recording: Mapping[str, Any]
    ) -> None:
        assert recording["baseUrl"] == BINANCE_TESTNET_REST_BASE

    def test_the_recorded_order_is_resting_and_unfilled(
        self, recording: Mapping[str, Any]
    ) -> None:
        """The proof must not have spent testnet funds."""
        submit = next(e for e in recording["requests"] if e["step"] == "submit")
        body = submit["response"]["body"]
        assert body["status"] == "NEW"
        assert body["executedQty"] == "0.00000000"
        assert body["cummulativeQuoteQty"] == "0.00000000"
        cancel = next(e for e in recording["requests"] if e["step"] == "cancel")
        assert cancel["response"]["body"]["status"] == "CANCELED"
        assert cancel["response"]["body"]["executedQty"] == "0.00000000"
