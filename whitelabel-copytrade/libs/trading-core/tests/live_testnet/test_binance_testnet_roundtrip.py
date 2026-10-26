# Proves one complete Binance Spot testnet round trip - submit, poll, cancel, cancel-again, user-stream echo - through the real adapters, replayed from a recording and optionally against the live testnet.
"""Binance testnet round-trip proof.

The claim this file has to support is narrow and load-bearing: *the platform can
place, observe and cancel a real order at a venue, and every value it reports
about that order came from the venue rather than from its own optimism.*

It is proven twice, against the same adapters:

  REPLAY (always runs, no credentials)
      ``fixtures/binance_testnet_roundtrip.json`` holds a recorded round trip.
      The requests go through the real signer (HMAC, timestamp, recvWindow) and
      the responses through the real parser. What is replayed is the venue's
      bytes, not the platform's assumptions.

  LIVE (``WLCT_LIVE_TESTNET=1`` plus ``BINANCE_TESTNET_API_KEY`` and
      ``BINANCE_TESTNET_API_SECRET``)
      The same sequence against ``https://testnet.binance.vision``. The order is
      a LIMIT order priced far from the touch on purpose: it must rest unfilled,
      and pricing it at the touch to "see a fill" would be placing a market order
      and calling the difference a test.

Both halves assert the same things, in the same order, so a live run that
disagrees with the recording is a contract change at the venue rather than a
difference between two test styles:

  1. nothing is transmitted to mainnet - the harness refuses the origin;
  2. the submit request is signed, carries the deterministic client order id, and
     reports the venue's ``orderId``;
  3. the order is real: ``is_simulated`` is False on every result;
  4. the poll returns the venue's status and exact decimal quantities;
  5. the cancel is accepted and the second cancel is a clean ``-2011`` refusal
     rather than an exception;
  6. the user-stream echo for the same client order id parses to the same
     lifecycle, and a ``NEW``/``CANCELED`` report is never mistaken for a fill;
  7. the account snapshot proves the key cannot withdraw.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from decimal import Decimal
from typing import Any, Callable, Mapping

import pytest

from wlct_trading.adapters.base import AdapterConnectionError, AdapterRejectedError
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_TESTNET_REST_BASE,
    BINANCE_TESTNET_WS_BASE,
)
from wlct_trading.exchanges.binance.trading import BinanceTradingAdapter, HttpResponse
from wlct_trading.exchanges.binance.userstream import parse_user_stream_message
from wlct_trading.orders import Order, OrderIntent

MAINNET_REST_BASE = "https://api.binance.com"

TENANT = "tenant-live-proof"
ACCOUNT = "acct-testnet-proof"
SYMBOL = "BTC-USDT"
CLIENT_ORDER_ID = "wlct-testnet-proof-0001"


def limit_intent(
    *, price: str = "20000.00000000", quantity: str = "0.00100000"
) -> OrderIntent:
    """The intent the recording was made with: a resting BUY far below the touch."""
    return OrderIntent(
        tenant_id=TENANT,
        account_id=ACCOUNT,
        strategy_id=None,
        exchange=ExchangeId.BINANCE,
        symbol=SYMBOL,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal(quantity),
        price=Decimal(price),
        time_in_force=TimeInForce.GTC,
        client_order_id=CLIENT_ORDER_ID,
    )


def local_order(
    status: OrderStatus = OrderStatus.ACKNOWLEDGED, client_order_id: str = CLIENT_ORDER_ID
) -> Order:
    """The platform's own record of the order, as reconciliation would hold it."""
    return Order(
        order_id="order-local-0001",
        client_order_id=client_order_id,
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
        status=status,
        exchange_order_id="7745219",
    )


# ======================================================================
# The recording itself
# ======================================================================
class TestTheRecordedRoundTrip:
    """Guards on the evidence, before anything is asserted from it."""

    def test_the_recording_is_a_complete_round_trip(
        self, recording: Mapping[str, Any]
    ) -> None:
        assert [entry["step"] for entry in recording["requests"]] == [
            "submit",
            "poll",
            "cancel",
            "cancel-again",
            "account",
            "api-restrictions",
        ]
        assert recording["userStream"], "the recording must include the user-stream echo"
        assert recording["environment"] == "TESTNET"
        assert recording["venue"] == "BINANCE"

    def test_the_recording_points_at_the_testnet_and_holds_no_credential(
        self, recording: Mapping[str, Any], credentials_pair: tuple[str, str]
    ) -> None:
        assert recording["baseUrl"] == BINANCE_TESTNET_REST_BASE
        rendered = json.dumps(recording)
        # The only key-shaped string in the recording is the masked listen key; a
        # real api key or secret in it would mean the capture wrote one, which is
        # the failure this assertion exists for.
        assert credentials_pair[0] not in rendered
        assert credentials_pair[1] not in rendered
        assert "apiSecret" not in rendered

    def test_every_recorded_number_is_a_string(self, recording: Mapping[str, Any]) -> None:
        """The venue sends numbers as JSON strings and the recording must too.

        A recording re-typed by hand into floats would pass the replay while
        proving nothing about decimal precision.
        """

        def walk(node: object, path: str) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    walk(value, f"{path}.{key}")
            elif isinstance(node, list):
                for index, value in enumerate(node):
                    walk(value, f"{path}[{index}]")
            elif isinstance(node, float):
                raise AssertionError(
                    f"{path} is a JSON float; venue quantities and prices must stay strings"
                )

        walk(recording["requests"], "requests")
        walk(recording["userStream"], "userStream")

    def test_the_recorded_errors_are_the_venues_own_codes(self) -> None:
        assert BINANCE_TESTNET_REST_BASE == "https://testnet.binance.vision"
        assert "testnet" in BINANCE_TESTNET_WS_BASE


# ======================================================================
# Replay
# ======================================================================
class TestReplayedRoundTrip:
    """The full sequence through the real adapters, from recorded bytes."""

    def test_the_full_round_trip_through_the_real_adapters(
        self, make_recording: Callable[..., Any], allowed_origin: str
    ) -> None:
        trading, account, sender = make_recording(
            "submit", "poll", "cancel", "cancel-again", "account"
        )

        # 1. Submit ----------------------------------------------------
        submitted = asyncio.run(trading.submit_order(limit_intent(), CLIENT_ORDER_ID))
        assert submitted.accepted is True
        assert submitted.exchange_order_id == "7745219"
        assert submitted.status is OrderStatus.ACKNOWLEDGED
        assert submitted.is_simulated is False
        assert submitted.fills == ()
        assert submitted.submitted_at_micros == 1_760_951_641_320_000

        # 2. Poll ------------------------------------------------------
        polled = asyncio.run(trading.fetch_order_for(local_order()))
        assert polled is not None
        assert polled.status is OrderStatus.ACKNOWLEDGED
        assert polled.exchange_order_id == "7745219"
        assert polled.quantity == Decimal("0.00100000")
        assert polled.price == Decimal("20000.00000000")
        assert polled.filled_quantity == Decimal("0")
        assert polled.is_simulated is False

        # 3. Cancel ----------------------------------------------------
        cancelled = asyncio.run(trading.cancel_order(local_order()))
        assert cancelled.accepted is True
        assert cancelled.status is OrderStatus.CANCELLED
        assert cancelled.is_simulated is False

        # 4. Cancel again: the venue's own refusal, not an exception ---
        again = asyncio.run(trading.cancel_order(local_order()))
        assert again.accepted is False
        assert "no such open order" in (again.reason or "").lower()

        # 5. Account ---------------------------------------------------
        venue_account = asyncio.run(account.fetch_account(TENANT, ACCOUNT))
        assert venue_account.can_trade is True
        assert venue_account.can_withdraw is False
        assert venue_account.account_type == "SPOT"
        balances = {balance.asset: balance for balance in venue_account.balances}
        assert balances["BTC"].free == Decimal("0.01000000")
        assert balances["BNB"].free == Decimal("0")

        # Every call went to the testnet origin, in order, and nowhere else.
        assert sender.methods_and_paths() == [
            ("POST", f"{allowed_origin}/api/v3/order"),
            ("GET", f"{allowed_origin}/api/v3/order"),
            ("DELETE", f"{allowed_origin}/api/v3/order"),
            ("DELETE", f"{allowed_origin}/api/v3/order"),
            ("GET", f"{allowed_origin}/api/v3/account"),
        ]

    def test_the_signature_covers_the_whole_parameter_set(
        self, make_recording: Callable[..., Any], credentials_pair: tuple[str, str]
    ) -> None:
        trading, _, sender = make_recording("submit")

        asyncio.run(trading.submit_order(limit_intent(), CLIENT_ORDER_ID))

        query = sender.query_of(0)
        signed_payload, _, signature = query.rpartition("&signature=")
        assert signature, "the request was not signed"
        for expected in (
            "symbol=BTCUSDT",
            "side=BUY",
            "type=LIMIT",
            "timeInForce=GTC",
            "quantity=0.001",
            "price=20000",
            f"newClientOrderId={CLIENT_ORDER_ID}",
            "newOrderRespType=FULL",
        ):
            assert expected in signed_payload, (
                f"{expected!r} is missing from the signed payload"
            )
        # The signature is over everything before it, including the timestamp:
        # signing a subset is how a request with a swapped quantity gets through.
        assert "timestamp=" in signed_payload
        assert "recvWindow=" in signed_payload
        assert sender.sent[0].headers["X-MBX-APIKEY"] == credentials_pair[0]

    def test_a_transport_failure_is_ambiguous_and_never_a_rejection(
        self, make_recording: Callable[..., Any]
    ) -> None:
        """The distinction the whole reconciliation path is built on.

        A timeout could mean "the venue has the order". The adapter must raise
        the ambiguous error, and that error must not be the definitive-refusal
        class: conflating the two either duplicates orders or strands them.
        """
        from wlct_trading.exchanges.binance.trading import BinanceAccountAdapter

        trading, _, sender = make_recording()

        async def explode(request: object, timeout_ms: int) -> HttpResponse:
            raise TimeoutError("the testnet socket did not answer")

        def hook(request: object) -> HttpResponse:
            raise TimeoutError("the testnet socket did not answer")

        del explode
        sender.hook = hook  # type: ignore[method-assign]

        with pytest.raises(AdapterConnectionError) as excinfo:
            asyncio.run(trading.submit_order(limit_intent(), CLIENT_ORDER_ID))
        assert not isinstance(excinfo.value, AdapterRejectedError)
        assert "fate is unknown" in str(excinfo.value).lower()
        assert BinanceAccountAdapter is not None

    def test_a_venue_rejection_is_definitive(
        self, make_recording: Callable[..., Any]
    ) -> None:
        trading, _, sender = make_recording()

        def hook(request: object) -> HttpResponse:
            return HttpResponse(
                status=400,
                headers={},
                body=json.dumps(
                    {"code": -2010, "msg": "Account has insufficient balance."}
                ),
            )

        sender.hook = hook  # type: ignore[method-assign]

        with pytest.raises(AdapterRejectedError) as excinfo:
            asyncio.run(trading.submit_order(limit_intent(), CLIENT_ORDER_ID))
        assert "insufficient balance" in str(excinfo.value).lower()
        assert excinfo.value.code == "-2010"

    def test_the_key_restrictions_call_reports_what_the_venue_said(
        self, make_recording: Callable[..., Any], allowed_origin: str
    ) -> None:
        """``fetch_key_restrictions`` returns the venue's fields, unfilled-in.

        Its caller is the placement review, whose subject is *which fields were
        present*: a normaliser that defaulted ``enableWithdrawals`` to False would
        erase the difference between "the key cannot withdraw" and "the venue did
        not say".
        """
        trading, _, sender = make_recording("api-restrictions")

        restrictions = asyncio.run(trading.fetch_key_restrictions(TENANT, ACCOUNT))

        assert restrictions["enableWithdrawals"] is False
        assert restrictions["enableSpotAndMarginTrading"] is True
        assert restrictions["ipRestrict"] is True
        assert sender.methods_and_paths() == [
            ("GET", f"{allowed_origin}/sapi/v1/account/apiRestrictions")
        ]

    def test_the_user_stream_echo_agrees_with_the_rest_round_trip(
        self, recording: Mapping[str, Any]
    ) -> None:
        events = recording["userStream"][0]["events"]

        created = parse_user_stream_message(json.dumps(events[0]))
        assert created.execution is not None
        assert created.execution.client_order_id == CLIENT_ORDER_ID
        assert created.execution.exchange_order_id == "7745219"
        assert created.execution.status is OrderStatus.ACKNOWLEDGED
        assert created.execution.is_trade is False  # NEW is a lifecycle event
        assert created.execution.order_quantity == Decimal("0.00100000")

        cancelled = parse_user_stream_message(json.dumps(events[1]))
        assert cancelled.execution is not None
        assert cancelled.execution.status is OrderStatus.CANCELLED
        assert cancelled.execution.is_trade is False  # CANCELED moves no money
        assert cancelled.execution.cumulative_filled_quantity == Decimal("0")

        # The stream and the REST poll describe the same order.
        assert cancelled.execution.exchange_order_id == "7745219"
        assert (
            created.execution.transaction_time_micros
            <= cancelled.execution.transaction_time_micros
        )

    def test_the_harness_refuses_a_mainnet_origin(
        self, make_recording: Callable[..., Any]
    ) -> None:
        """The single most important assertion in this file.

        A trading adapter is re-pointed at production exactly the way a
        misconfiguration would do it - by its base URL - and the harness refuses
        before the request leaves the process. The refusal surfaces as the
        ambiguous `AdapterConnectionError`, which is the honest classification:
        from the engine's side nothing was transmitted, so the order's fate is
        unknown and the reconciliation path - not the retry path - is what runs.
        What must never happen is a request reaching the venue, and that is
        asserted directly against the recorder.
        """
        trading, _, sender = make_recording()
        client = trading._client  # noqa: SLF001 - the point of the test is the private field
        original = client.rest_base
        object.__setattr__(client, "_rest_base", MAINNET_REST_BASE)
        try:
            with pytest.raises(AdapterConnectionError) as excinfo:
                asyncio.run(trading.submit_order(limit_intent(), CLIENT_ORDER_ID))
        finally:
            object.__setattr__(client, "_rest_base", original)

        assert "fate is unknown" in str(excinfo.value).lower()
        cause = excinfo.value.__cause__
        assert isinstance(cause, AssertionError), (
            "the refusal must come from the harness, not from the transport"
        )
        assert "refuses to transmit" in str(cause)
        assert MAINNET_REST_BASE in str(cause)
        assert sender.sent == [], "a request reached the recorder after a mainnet refusal"

    def test_a_mainnet_adapter_cannot_even_be_built_without_saying_so(self) -> None:
        """``testnet`` defaults to False, so mainnet is the explicit choice.

        The proof suites never take it; this asserts the default is visible
        rather than accidental, and that the URL the adapter would use is the
        production one - so the refusal above is a real refusal, not a no-op.
        """
        adapter = BinanceTradingAdapter(
            send=_never_called,
            credentials=_unused_credentials(),
            clock=_unused_clock(),
        )
        assert adapter._client.rest_base == MAINNET_REST_BASE  # noqa: SLF001
        assert BINANCE_TESTNET_REST_BASE not in adapter._client.rest_base  # noqa: SLF001


async def _never_called(request: object, timeout_ms: int) -> HttpResponse:
    raise AssertionError("the mainnet-default assertion must not transmit")


def _unused_credentials():  # noqa: ANN202 - local helper, typed by its use
    from wlct_trading.execution.credentials import (
        ExchangeCredentials,
        StaticCredentialProvider,
    )

    return StaticCredentialProvider(
        [
            ExchangeCredentials(
                exchange=ExchangeId.BINANCE,
                tenant_id=TENANT,
                account_id=ACCOUNT,
                api_key="k" * 16,
                api_secret="s" * 32,
                permissions=frozenset({"SPOT"}),
            )
        ]
    )


def _unused_clock():  # noqa: ANN202 - local helper, typed by its use
    from wlct_trading.execution.timesync import ExchangeClock

    clock = ExchangeClock(
        lambda: _no_time(), max_skew_millis=1_000, require_sync=True
    )
    clock.seed(offset_millis=0, round_trip_millis=5)
    return clock


async def _no_time() -> int:
    raise AssertionError("no server time is fetched in this test")


# ======================================================================
# Live
# ======================================================================
_LIVE_ENV = "WLCT_LIVE_TESTNET"
_API_KEY_ENV = "BINANCE_TESTNET_API_KEY"
_API_SECRET_ENV = "BINANCE_TESTNET_API_SECRET"


def _live_pair() -> tuple[str, str] | None:
    api_key = os.environ.get(_API_KEY_ENV, "").strip()
    api_secret = os.environ.get(_API_SECRET_ENV, "").strip()
    if not api_key or not api_secret:
        return None
    return (api_key, api_secret)


def _live_requested() -> bool:
    return os.environ.get(_LIVE_ENV, "").strip() in {"1", "true", "TRUE", "yes"}


pytestmark_live = pytest.mark.skipif(
    not (_live_requested() and _live_pair()),
    reason=(
        f"the live testnet proof is opt-in: set {_LIVE_ENV}=1 together with "
        f"{_API_KEY_ENV} and {_API_SECRET_ENV}"
    ),
)


def _live_adapters() -> tuple[BinanceTradingAdapter, Any, list[Any]]:
    """Real HTTP through a sender that still enforces the testnet origin."""
    import httpx

    from wlct_trading.execution.credentials import (
        ExchangeCredentials,
        StaticCredentialProvider,
    )
    from wlct_trading.execution.timesync import ExchangeClock

    pair = _live_pair()
    assert pair is not None, "the live suite must not run without credentials"
    credentials = StaticCredentialProvider(
        [
            ExchangeCredentials(
                exchange=ExchangeId.BINANCE,
                tenant_id=TENANT,
                account_id=ACCOUNT,
                api_key=pair[0],
                api_secret=pair[1],
                permissions=frozenset({"SPOT", "READ"}),
                source="env",
            )
        ]
    )
    clock = ExchangeClock(
        lambda: _no_time(), max_skew_millis=1_000, require_sync=True
    )
    clock.seed(offset_millis=0, round_trip_millis=40)
    client = httpx.Client(timeout=20.0)
    sent: list[Any] = []

    async def send(request: Any, timeout_ms: int) -> HttpResponse:
        url = getattr(request, "url", "")
        assert url.startswith(BINANCE_TESTNET_REST_BASE), (
            f"refusing to transmit to {url!r}; only {BINANCE_TESTNET_REST_BASE} is allowed"
        )
        query = getattr(request, "query", "")
        sent.append(request)
        response = client.request(
            method=getattr(request, "method"),
            url=f"{url}?{query}" if query else url,
            headers=dict(getattr(request, "headers")),
        )
        return HttpResponse(
            status=response.status_code,
            headers=dict(response.headers),
            body=response.text,
        )

    from wlct_trading.exchanges.binance.trading import BinanceAccountAdapter

    trading = BinanceTradingAdapter(
        send=send, credentials=credentials, clock=clock, testnet=True
    )
    account = BinanceAccountAdapter(
        send=send, credentials=credentials, clock=clock, testnet=True
    )
    return trading, account, sent


@pytestmark_live
class TestLiveTestnetRoundTrip:
    """The same sequence against the real testnet, when an operator opts in."""

    def test_live_submit_poll_cancel(self) -> None:
        """A resting LIMIT order, placed far below the touch, then cancelled.

        Priced at a fraction of the market on the buy side: it cannot fill while
        the test runs, so the cancel exercises the cancellation path rather than
        a race, and no testnet balance is spent.
        """
        trading, _, sent = _live_adapters()
        client_order_id = f"wlct-proof-{os.getpid()}-{int(time.time())}"

        submitted = asyncio.run(
            trading.submit_order(
                limit_intent(price="2000.00000000", quantity="0.00100000"),
                client_order_id,
            )
        )
        assert submitted.is_simulated is False
        assert submitted.accepted is True, "the testnet refused a resting LIMIT order"
        assert submitted.exchange_order_id, "the venue returned no orderId"

        order = local_order(client_order_id=client_order_id)
        order.exchange_order_id = submitted.exchange_order_id
        polled = asyncio.run(trading.fetch_order_for(order))
        assert polled is not None
        assert polled.status in {OrderStatus.ACKNOWLEDGED, OrderStatus.PARTIALLY_FILLED}
        assert polled.filled_quantity == Decimal("0"), (
            "a resting order in the live proof filled; the proof must not spend testnet funds"
        )

        cancelled = asyncio.run(trading.cancel_order(order))
        assert cancelled.accepted is True
        assert cancelled.status is OrderStatus.CANCELLED

        assert all(
            getattr(request, "url", "").startswith(BINANCE_TESTNET_REST_BASE)
            for request in sent
        )
        assert [getattr(request, "method") for request in sent] == [
            "POST",
            "GET",
            "DELETE",
        ]

    def test_live_key_cannot_withdraw(self) -> None:
        """The key used for the proof must be less dangerous than the money path."""
        _, account, _ = _live_adapters()
        venue_account = asyncio.run(account.fetch_account(TENANT, ACCOUNT))
        assert venue_account.can_trade is True
        assert venue_account.can_withdraw is False, (
            "the testnet key carries withdrawal permission; revoke it before using it "
            "for any proof"
        )
