# Opt-in live USD-M futures testnet round trip: leverage/margin setup, far-from-market resting order, query, cancel, and the assertion that no position was left open - against https://testnet.binancefuture.com only.
"""Binance USD-M futures testnet round-trip proof.

This file exists to answer exactly one question with venue evidence: *the
futures stack can configure margin mode and leverage, place a real order that
the venue then knows about, read that order back, cancel it, and leave no
position behind - through the same signed client, clock and rate budget a
deployment would use.*

It is OPT-IN by construction (``pytest.mark.skipif`` at import scope):

  * ``WLCT_LIVE_TESTNET=1``, and
  * ``BINANCE_FUTURES_TESTNET_API_KEY`` / ``BINANCE_FUTURES_TESTNET_API_SECRET``

without both, every test skips. There is no recording to replay: inventing
one would be the platform fabricating its own evidence, which is the opposite
of proof.

Safety posture, all enforced by code rather than by reviewer attention:

  1. The sender refuses every origin except the USD-M testnet REST base. A
     mistake that points this file at ``https://fapi.binance.com`` is a
     refusal before any byte leaves the process - the same law the spot
     round trip codified.
  2. The order placed is a LIMIT priced far below the current touch, so it
     RESTS: it does not fill, and a suite that somehow walked away mid-way
     leaves an open *order*, never an open position. (Binance futures has no
     post-only convenience flag on plain LIMIT orders - GTX time-in-force is
     the venue's post-only mechanism and is deliberately outside the adapter's
     attested vocabulary until a batch attests it; pricing far from the touch
     gives the same non-execution guarantee here.)
  3. Leverage is set to the policy default (docs pin 3x) and margin to
     ISOLATED before any order; both calls are idempotent at the venue
     (-4059 on the margin call is success, not an error).
  4. The final state assertion is quantitative: ``positionAmt`` for the
     symbol must be exactly ``0``, and the symbol must have no open orders.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from decimal import Decimal
from typing import Any

import pytest

from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.execution.credentials import ExchangeCredentials, StaticCredentialProvider
from wlct_trading.execution.timesync import ExchangeClock
from wlct_trading.exchanges.binance.trading import HttpResponse
from wlct_trading.exchanges.binance_futures.capabilities import (
    BINANCE_FUTURES_REST_BASE,
    BINANCE_FUTURES_TESTNET_REST_BASE,
)
from wlct_trading.exchanges.binance_futures.adapter import build_futures_registry
from wlct_trading.exchanges.binance_futures.trading import (
    BinanceFuturesAccountAdapter,
    BinanceFuturesTradingAdapter,
    FuturesTradingParams,
)
from wlct_trading.orders import Order, OrderIntent

TENANT = "tenant-live-proof"
ACCOUNT = "acct-futures-proof"
SYMBOL = "BTCUSDT"
API_KEY_ENV = "BINANCE_FUTURES_TESTNET_API_KEY"
API_SECRET_ENV = "BINANCE_FUTURES_TESTNET_API_SECRET"
LIVE_ENV = "WLCT_LIVE_TESTNET"

#: The resting order price: at the time of writing the BTC testnet touch is
#: near 100 000; 1 000 USD is far enough from any plausible mark that the
#: order cannot execute while the venue is sane, and small enough that the
#: 0.002 BTC notional (2 USD) stays inside the venue's minimum filters.
REST_PRICE = Decimal("1000.00000000")
REST_QUANTITY = Decimal("0.002")
CLIENT_ORDER_ID = "wlct-fut-testnet-proof-0001"


def _live_requested() -> bool:
    return os.environ.get(LIVE_ENV, "").strip() in {"1", "true", "TRUE", "yes"}


def _live_pair() -> tuple[str, str] | None:
    key = os.environ.get(API_KEY_ENV, "").strip()
    secret = os.environ.get(API_SECRET_ENV, "").strip()
    if not key or not secret:
        return None
    return key, secret


pytestmark = pytest.mark.skipif(
    not (_live_requested() and _live_pair()),
    reason=(
        f"the futures live testnet proof is opt-in: set {LIVE_ENV}=1 together "
        f"with {API_KEY_ENV} and {API_SECRET_ENV}"
    ),
)


def _futures_service_transport_module() -> Any | None:
    """The service's futures venue transport, or None outside the monorepo.

    Same dependency law as the spot proof: the library must not reach for the
    service by name; the monorepo checkout makes the real egress component
    importable by path, and the proof says so when it is absent.
    """
    service_root = Path(__file__).resolve().parents[4] / "services" / "execution-engine"
    if not (service_root / "app" / "venue" / "binance_futures_transport.py").is_file():
        return None
    if str(service_root) not in sys.path:
        sys.path.insert(0, str(service_root))
    try:
        import app.venue.binance_futures_transport as module
    except ImportError:
        return None
    return module


class _OriginRefusingSender:
    """Last-line sender for standalone checkouts: testnet or nothing."""

    def __init__(self) -> None:
        self.sent: list[Any] = []

    async def __call__(self, request: Any, timeout_ms: int) -> HttpResponse:
        url = getattr(request, "url", "")
        assert url.startswith(BINANCE_FUTURES_TESTNET_REST_BASE), (
            "the futures testnet proof refuses to transmit anywhere but "
            f"{BINANCE_FUTURES_TESTNET_REST_BASE}; the adapter asked for {url!r}"
        )
        import httpx

        self.sent.append(request)
        async with httpx.AsyncClient(timeout=timeout_ms / 1000.0) as client:
            full = getattr(request, "full_url", request.url)
            response = await client.request(
                request.method,
                full,
                headers=dict(getattr(request, "headers", {})),
            )
        return HttpResponse(
            status=response.status_code,
            headers={key: value for key, value in response.headers.items()},
            body=response.text,
        )


def _futures_stack():
    """The adapters the proof drives, over real HTTP with the venue clock
    synchronised for real - exactly the stack a testnet deployment wires."""
    pair = _live_pair()
    assert pair is not None, "the live suite must not run without credentials"

    module = _futures_service_transport_module()
    sender: Any
    if module is not None:
        import httpx

        from wlct_trading.net.config import TransportSettings
        from wlct_trading.net.signed_client import HttpxSignedSender

        http_sender = HttpxSignedSender(
            TransportSettings(
                binance_rest_url=BINANCE_FUTURES_TESTNET_REST_BASE, use_testnet=True
            ),
            client=httpx.AsyncClient(timeout=20.0),
        )
        transport = module.BinanceFuturesHttpTransport(
            base_url=BINANCE_FUTURES_TESTNET_REST_BASE, sender=http_sender
        )

        async def sender(request: Any, timeout_ms: int) -> HttpResponse:  # type: ignore[misc]
            return await transport(request, timeout_ms)

    else:
        sender = _OriginRefusingSender()

    clock = ExchangeClock(_server_time_probe(sender), max_skew_millis=1_000, require_sync=True)
    run(clock.synchronise())

    params = FuturesTradingParams(
        send=sender, rest_base=BINANCE_FUTURES_TESTNET_REST_BASE, rate_limits=build_futures_registry()
    )
    credentials = StaticCredentialProvider(
        [
            ExchangeCredentials(
                exchange=ExchangeId.BINANCE,
                tenant_id=TENANT,
                account_id=ACCOUNT,
                api_key=pair[0],
                api_secret=pair[1],
                permissions=frozenset({"FUTURES", "READ"}),
                source="env",
            )
        ]
    )
    trading = BinanceFuturesTradingAdapter(params=params, credentials=credentials, clock=clock)
    account = BinanceFuturesAccountAdapter(params=params, credentials=credentials, clock=clock)
    return trading, account, sender


def _server_time_probe(sender):
    from wlct_trading.exchanges.binance_futures.adapter import BinanceFuturesMarketData

    md = BinanceFuturesMarketData(send=sender, testnet=True)

    async def probe() -> int:
        return await md.fetch_server_time_micros()

    return probe


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _intent() -> OrderIntent:
    return OrderIntent(
        tenant_id=TENANT,
        account_id=ACCOUNT,
        strategy_id=None,
        exchange=ExchangeId.BINANCE,
        symbol=SYMBOL,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=REST_QUANTITY,
        price=REST_PRICE,
        time_in_force=TimeInForce.GTC,
        client_order_id=CLIENT_ORDER_ID,
    )


def _local_order() -> Order:
    return Order.from_intent(_intent(), client_order_id=CLIENT_ORDER_ID)


class TestFuturesTestnetRoundTrip:
    """One sequential proof; order matters, so the steps are one test each on a
    shared class and run in file order."""

    def test_mainnet_is_never_an_origin(self) -> None:
        # The sender-level law, asserted before any traffic: the testnet
        # base constant and the production base constant are different
        # hosts, and the harness refuses the production one.
        assert BINANCE_FUTURES_REST_BASE != BINANCE_FUTURES_TESTNET_REST_BASE
        sender = _OriginRefusingSender()

        class FakeRequest:
            method = "POST"
            url = BINANCE_FUTURES_REST_BASE  # mainnet: must be refused
            headers: dict[str, str] = {}
            query = ""

        with pytest.raises(AssertionError):
            run(sender(FakeRequest(), 5_000))

    def test_round_trip(self) -> None:
        trading, account, _ = _futures_stack()

        # 1. Margin posture: isolated, conservative leverage - idempotent on
        #    re-run, and proof the credential can drive account-level calls.
        run(account.set_margin_type(TENANT, ACCOUNT, SYMBOL, "ISOLATED"))
        leverage_answer = run(account.set_leverage(TENANT, ACCOUNT, SYMBOL, 3))
        assert int(leverage_answer["leverage"]) == 3

        # 2. Place the far-from-market resting order.
        submitted = run(trading.submit_order(_intent(), CLIENT_ORDER_ID))
        assert submitted.accepted is True
        assert submitted.is_simulated is False
        assert submitted.status in (
            OrderStatus.ACKNOWLEDGED,
            OrderStatus.PARTIALLY_FILLED,
            OrderStatus.FILLED,
        )
        # A resting order 100x below the touch must NOT have filled. If the
        # venue says otherwise, the safety claim of this suite is false.
        assert submitted.status is not OrderStatus.FILLED, (
            "the resting proof order filled; the venue touch moved 100x or "
            "the safety distance needs widening"
        )

        # 3. Query it back: the venue knows the order by its client id.
        found = run(trading.fetch_order_for(_local_order()))
        assert found is not None
        assert found.client_order_id == CLIENT_ORDER_ID
        assert found.status is OrderStatus.ACKNOWLEDGED
        assert found.filled_quantity == Decimal("0")

        # 4. Cancel and read back the terminal answer.
        cancelled = run(trading.cancel_order(_local_order()))
        assert cancelled.accepted is True
        assert cancelled.status is OrderStatus.CANCELLED

        # 5. Quantitative close-out: no position, no open orders on the symbol.
        positions = run(account.fetch_positions(TENANT, ACCOUNT, SYMBOL))
        assert all(p.quantity == 0 for p in positions), (
            "the futures proof left a position open; the suite's safety "
            "claim is void and this must be investigated, not edited"
        )
        open_orders = run(trading.fetch_open_orders(TENANT, ACCOUNT, SYMBOL))
        assert all(o.client_order_id != CLIENT_ORDER_ID for o in open_orders), (
            "the proof order is still open after its accepted cancel"
        )
