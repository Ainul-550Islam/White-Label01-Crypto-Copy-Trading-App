"""Part 5: authenticated execution.

Thirty deterministic cases covering signing, credential safety, validation,
the safety gates, idempotency, the ambiguous-result path, reconciliation and
the private stream.

Two rules govern every test here:

* **No real credentials.** Every key and secret in this file is a literal
  fixture. Nothing in the suite can reach a real venue, and nothing needs to.
* **No network, no clock, no sleep.** Every dependency is a deterministic
  fake, so a failure means a behaviour changed rather than that a socket was
  slow.

Coroutines are driven with ``asyncio.run`` rather than ``pytest-asyncio``,
which is deliberately not a dependency of this project.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from decimal import Decimal
from typing import Any

import pytest

from wlct_trading.adapters.base import (
    AccountBalance,
    AdapterConnectionError,
    AdapterRateLimitedError,
    AdapterRejectedError,
    SubmitResult,
    SymbolSpecification,
    VenueAccount,
)
from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
    TradingMode,
)
from wlct_trading.exchanges.binance.signing import (
    SignatureError,
    binance_signature,
    build_signed_request,
    encode_params,
    format_decimal,
)
from wlct_trading.exchanges.binance.trading import (
    BinanceTradingAdapter,
    HttpResponse,
)
from wlct_trading.exchanges.binance.userstream import (
    ListenKeyManager,
    UserStreamEventType,
    mask_listen_key,
    parse_user_stream_message,
)
from wlct_trading.execution import (
    ClockNotSynchronised,
    ClockSkewExceeded,
    ComponentHealth,
    EngineConfigurationError,
    ExchangeClock,
    ExchangeCredentials,
    ExecutionContext,
    ExecutionEngine,
    ExecutionErrorCode,
    ExecutionOutcome,
    ExecutionSettings,
    InMemoryIncidentRecorder,
    InMemoryLockManager,
    InMemoryOrderStore,
    IncidentType,
    OrderValidator,
    ReconciliationService,
    ReconciliationState,
    StaticCredentialProvider,
    UnsafeExecutionConfiguration,
    ValidationCode,
    evaluate_safety_gates,
    scrub_secret_like,
)
from wlct_trading.execution.safety import ExecutionPreconditions
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.positions import PositionManager
from wlct_trading.risk import KillSwitchState, RiskEngine, RiskLimits, RiskSnapshot

# ----------------------------------------------------------------------
# Fixtures: entirely synthetic, never a real key
# ----------------------------------------------------------------------
FAKE_API_KEY = "TESTKEY0000000000000000000000000000000000000000000000000000AAAA"
FAKE_API_SECRET = "TESTSECRET0000000000000000000000000000000000000000000000000BBBB"

#: The worked example from Binance's own signing documentation. Using the
#: published vector means this test verifies the implementation against the
#: venue's specification rather than against itself.
DOC_SECRET = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
DOC_QUERY = (
    "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&"
    "price=0.1&recvWindow=5000&timestamp=1499827319559"
)
DOC_SIGNATURE = (
    "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71"
)


def credentials(**overrides: Any) -> ExchangeCredentials:
    base: dict[str, Any] = {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "exchange": ExchangeId.BINANCE,
        "api_key": FAKE_API_KEY,
        "api_secret": FAKE_API_SECRET,
    }
    base.update(overrides)
    return ExchangeCredentials(**base)


def spec(**overrides: Any) -> SymbolSpecification:
    base: dict[str, Any] = {
        "symbol": "BTC/USDT",
        "venue_symbol": "BTCUSDT",
        "exchange": ExchangeId.BINANCE,
        "market_type": MarketType.SPOT,
        "base_asset": "BTC",
        "quote_asset": "USDT",
        "price_tick": Decimal("0.01"),
        "quantity_step": Decimal("0.00001"),
        "min_quantity": Decimal("0.00001"),
        "max_quantity": Decimal("9000"),
        "min_notional": Decimal("10"),
        "is_tradeable": True,
        "price_precision": 2,
        "quantity_precision": 5,
    }
    base.update(overrides)
    return SymbolSpecification(**base)


def intent(**overrides: Any) -> OrderIntent:
    base: dict[str, Any] = {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "strategy_id": "strategy-1",
        "exchange": ExchangeId.BINANCE,
        "symbol": "BTC/USDT",
        "side": OrderSide.BUY,
        "order_type": OrderType.LIMIT,
        "quantity": Decimal("0.01"),
        "price": Decimal("50000.00"),
        "time_in_force": TimeInForce.GTC,
    }
    base.update(overrides)
    return OrderIntent(**base)


def snapshot(**overrides: Any) -> RiskSnapshot:
    base: dict[str, Any] = {
        "position_quantity": Decimal(0),
        "symbol_exposure_notional": Decimal(0),
        "account_exposure_notional": Decimal(0),
        "open_order_count": 0,
        "orders_in_last_minute": 0,
        "realised_pnl_today": Decimal(0),
        "strategy_realised_pnl_today": Decimal(0),
        "reference_price": Decimal("50000.00"),
        "market_data_age_micros": 1_000,
        "book_usable": True,
        "is_complete": True,
        "known_client_order_ids": frozenset(),
    }
    base.update(overrides)
    return RiskSnapshot(**base)


def no_kill_switches() -> KillSwitchState:
    return KillSwitchState(
        global_engaged=False,
        engaged_exchanges=frozenset(),
        engaged_strategies=frozenset(),
        engaged_symbols=frozenset(),
        reason=None,
    )


def paper_settings(**overrides: Any) -> ExecutionSettings:
    """Settings that permit a simulated submission and transmit nothing."""
    base: dict[str, Any] = {
        "live_trading_enabled": False,
        "dry_run": False,
        "paper_trading": True,
        "trading_mode_setting": "PAPER",
        "trading_enabled": True,
        "live_trading_confirmed": False,
    }
    base.update(overrides)
    return ExecutionSettings(**base)


def healthy_context(**overrides: Any) -> ExecutionContext:
    base: dict[str, Any] = {
        "snapshot": snapshot(),
        "kill_switches": no_kill_switches(),
        "specification": spec(),
        "reference_price": Decimal("50000.00"),
        "risk_health": ComponentHealth.ok(age_micros=1_000),
        "market_data_health": ComponentHealth.ok(),
        "exchange_health": ComponentHealth.ok(),
        "credentials": credentials(),
    }
    base.update(overrides)
    return ExecutionContext(**base)


def risk_engine() -> RiskEngine:
    return RiskEngine(
        RiskLimits(
            max_order_quantity=Decimal("1000"),
            max_order_notional=Decimal("1000000"),
            max_position_quantity=Decimal("5000000"),
            max_symbol_exposure_notional=Decimal("5000000"),
            max_account_exposure_notional=Decimal("10000000"),
            max_open_orders=100,
            max_orders_per_minute=100,
            max_daily_loss=Decimal("1000000"),
            max_price_deviation_percent=Decimal("50"),
            max_market_data_age_micros=60_000_000,
        )
    )


class StubTradingAdapter:
    """A deterministic TradingAdapter stand-in.

    Not a subclass: the point is to control exactly what the engine observes,
    including raising the transport errors that make an outcome ambiguous.
    """

    def __init__(
        self,
        *,
        result: SubmitResult | None = None,
        error: Exception | None = None,
        simulated: bool = False,
        open_orders: tuple[Order, ...] = (),
        lookup: Order | None = None,
    ) -> None:
        self._result = result
        self._error = error
        self._simulated = simulated
        self._open_orders = open_orders
        self._lookup = lookup
        self.submit_calls: list[tuple[OrderIntent, str]] = []
        self.lookup_calls: list[str] = []

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    @property
    def is_simulated(self) -> bool:
        return self._simulated

    async def submit_order(
        self, order_intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        self.submit_calls.append((order_intent, client_order_id))
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result

    async def cancel_order(self, order: Order):  # pragma: no cover - unused here
        raise NotImplementedError

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        self.lookup_calls.append(client_order_id)
        return self._lookup

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        return self._open_orders

    async def exchange_time(self) -> int:
        return 1_700_000_000_000

    async def stream_fills(self, tenant_id: str, account_id: str):
        return
        yield  # pragma: no cover


class StubAccountAdapter:
    def __init__(self, balances: tuple[AccountBalance, ...] = ()) -> None:
        self._balances = balances

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    async def fetch_balances(self, tenant_id: str, account_id: str):
        return self._balances

    async def fetch_positions(self, tenant_id: str, account_id: str):
        return ()

    async def fetch_account(self, tenant_id: str, account_id: str) -> VenueAccount:
        return VenueAccount(
            exchange=ExchangeId.BINANCE,
            balances=self._balances,
            can_trade=True,
            can_withdraw=False,
            can_deposit=True,
            account_type="SPOT",
        )

    async def verify_credentials(self, tenant_id: str, account_id: str):
        return (True, "ok")


def build_engine(
    adapter: StubTradingAdapter,
    *,
    settings: ExecutionSettings | None = None,
    store: InMemoryOrderStore | None = None,
    incidents: InMemoryIncidentRecorder | None = None,
    positions: PositionManager | None = None,
) -> tuple[ExecutionEngine, InMemoryOrderStore, InMemoryIncidentRecorder]:
    order_store = store or InMemoryOrderStore()
    recorder = incidents or InMemoryIncidentRecorder()
    engine = ExecutionEngine(
        adapter=adapter,
        settings=settings or paper_settings(),
        risk_engine=risk_engine(),
        store=order_store,
        locks=InMemoryLockManager(),
        incidents=recorder,
        validator=OrderValidator(),
        positions=positions,
    )
    return (engine, order_store, recorder)


def accepted_result(**overrides: Any) -> SubmitResult:
    base: dict[str, Any] = {
        "accepted": True,
        "exchange_order_id": "28457",
        "status": OrderStatus.ACKNOWLEDGED,
        "is_simulated": False,
        "submitted_at_micros": 1_700_000_000_000_000,
        "fills": (),
    }
    base.update(overrides)
    return SubmitResult(**base)


# ======================================================================
# 1-7: signing, timestamps, skew, API key handling
# ======================================================================
class TestSigning:
    def test_01_signature_matches_the_published_vector(self) -> None:
        """The published worked example from Binance's own documentation."""
        assert binance_signature(DOC_SECRET, DOC_QUERY) == DOC_SIGNATURE

    def test_02_signature_is_deterministic_and_key_dependent(self) -> None:
        payload = "symbol=BTCUSDT&side=BUY&timestamp=1700000000000"
        first = binance_signature(FAKE_API_SECRET, payload)
        second = binance_signature(FAKE_API_SECRET, payload)
        assert first == second
        assert first != binance_signature(FAKE_API_SECRET + "x", payload)
        assert first != binance_signature(FAKE_API_SECRET, payload + "&x=1")
        # And it really is HMAC-SHA256 hex, not some other digest.
        assert first == hmac.new(
            FAKE_API_SECRET.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()

    def test_03_timestamp_and_recv_window_are_appended_in_a_fixed_order(self) -> None:
        request = build_signed_request(
            method="POST",
            base_url="https://api.binance.com",
            path="/api/v3/order",
            params=[("symbol", "BTCUSDT"), ("side", "BUY")],
            credentials=credentials(),
            timestamp_millis=1_700_000_000_000,
            recv_window_millis=5_000,
        )
        assert request.signed_payload == (
            "symbol=BTCUSDT&side=BUY&recvWindow=5000&timestamp=1700000000000"
        )
        # The signature is last and is not itself signed.
        assert request.query.endswith(
            "&signature=" + binance_signature(FAKE_API_SECRET, request.signed_payload)
        )
        assert "signature" not in request.signed_payload

    def test_04_api_key_travels_in_the_header_and_never_in_the_payload(self) -> None:
        request = build_signed_request(
            method="GET",
            base_url="https://api.binance.com",
            path="/api/v3/account",
            params=[],
            credentials=credentials(),
            timestamp_millis=1_700_000_000_000,
        )
        assert request.headers["X-MBX-APIKEY"] == FAKE_API_KEY
        assert FAKE_API_KEY not in request.query
        assert FAKE_API_SECRET not in request.query
        # And the repr, which is what ends up in a traceback, exposes neither.
        assert FAKE_API_KEY not in repr(request)
        assert FAKE_API_SECRET not in repr(request)
        assert FAKE_API_SECRET not in json.dumps(request.to_log_fields())

    def test_05_signing_refuses_plaintext_and_bad_timestamps(self) -> None:
        with pytest.raises(SignatureError, match="non-TLS"):
            build_signed_request(
                method="GET",
                base_url="http://api.binance.com",
                path="/api/v3/account",
                params=[],
                credentials=credentials(),
                timestamp_millis=1_700_000_000_000,
            )
        with pytest.raises(SignatureError, match="positive millisecond"):
            build_signed_request(
                method="GET",
                base_url="https://api.binance.com",
                path="/api/v3/account",
                params=[],
                credentials=credentials(),
                timestamp_millis=0,
            )
        with pytest.raises(SignatureError, match="recvWindow"):
            build_signed_request(
                method="GET",
                base_url="https://api.binance.com",
                path="/api/v3/account",
                params=[],
                credentials=credentials(),
                timestamp_millis=1_700_000_000_000,
                recv_window_millis=61_000,
            )

    def test_06_encoding_rejects_floats_and_renders_decimals_exactly(self) -> None:
        assert format_decimal(Decimal("0.00001000")) == "0.00001"
        assert format_decimal(Decimal("1E-8")) == "0.00000001"
        assert format_decimal(Decimal("100")) == "100"
        assert format_decimal(Decimal("50000.00")) == "50000"
        with pytest.raises(SignatureError, match="float"):
            encode_params([("price", 0.1)])
        # Reserved characters are escaped identically on both sides.
        assert encode_params([("a", "b/c")]) == "a=b%2Fc"

    def test_07_clock_skew_beyond_the_limit_refuses_to_produce_a_timestamp(
        self,
    ) -> None:
        async def never_called() -> int:  # pragma: no cover - not reached
            raise AssertionError("The clock must not call the venue here.")

        clock = ExchangeClock(never_called, max_skew_millis=1_000)

        # Never synchronised: refuse rather than use the local clock.
        with pytest.raises(ClockNotSynchronised):
            clock.timestamp_millis()

        # Synchronised but the host clock is five seconds out: still refuse.
        clock.seed(offset_millis=5_000)
        with pytest.raises(ClockSkewExceeded) as excinfo:
            clock.timestamp_millis()
        assert excinfo.value.offset_millis == 5_000

        # Within tolerance: the offset is applied to the local clock.
        clock.reset()
        clock.seed(offset_millis=250)
        now_micros = 1_700_000_000_000_000
        assert (
            clock.timestamp_millis(now_micros=now_micros) == 1_700_000_000_000 + 250
        )


# ======================================================================
# 8-9: credential handling and redaction
# ======================================================================
class TestCredentialSecurity:
    def test_08_credentials_are_redacted_in_every_rendering_path(self) -> None:
        creds = credentials()
        rendered = [
            repr(creds),
            str(creds),
            f"{creds}",
            json.dumps(creds.to_log_fields()),
            repr([creds]),
            repr({"c": creds}),
        ]
        for text in rendered:
            assert FAKE_API_SECRET not in text, text
            assert FAKE_API_KEY not in text, text
        assert creds.api_key_last_four == FAKE_API_KEY[-4:]
        # The secret is still usable where it is legitimately needed.
        assert creds.matches_secret(FAKE_API_SECRET)
        # And free-text scrubbing catches a secret pasted into a message.
        assert FAKE_API_SECRET not in scrub_secret_like(
            f"failed with secret {FAKE_API_SECRET}"
        )

    def test_09_withdrawal_capable_credentials_are_refused(self) -> None:
        unsafe = credentials(permissions=frozenset({"SPOT", "WITHDRAW"}))
        with pytest.raises(Exception) as excinfo:
            unsafe.assert_safe()
        assert "withdraw" in str(excinfo.value).lower()
        assert FAKE_API_SECRET not in str(excinfo.value)

        gate = evaluate_safety_gates(
            ExecutionPreconditions(
                exchange="BINANCE",
                symbol="BTC/USDT",
                strategy_id="s1",
                kill_switches=no_kill_switches(),
                settings=paper_settings(paper_trading=False, trading_mode_setting="PAPER"),
                risk_health=ComponentHealth.ok(),
                market_data_health=ComponentHealth.ok(),
                exchange_health=ComponentHealth.ok(),
                credentials=unsafe,
                is_simulated=False,
            )
        )
        assert not gate.allowed


# ======================================================================
# 10-12: authenticated request generation and HTTP error handling
# ======================================================================
class TestAuthenticatedRequests:
    @staticmethod
    def _adapter(responses: list[HttpResponse]) -> tuple[BinanceTradingAdapter, list]:
        sent: list = []

        async def send(request, timeout_ms: int) -> HttpResponse:
            sent.append(request)
            return responses.pop(0)

        clock = ExchangeClock(lambda: asyncio.sleep(0, result=0))
        clock.seed(offset_millis=0)
        provider = StaticCredentialProvider([credentials()])
        adapter = BinanceTradingAdapter(
            send=send, credentials=provider, clock=clock, testnet=True
        )
        return (adapter, sent)

    def test_10_order_placement_builds_a_correctly_signed_request(self) -> None:
        body = json.dumps(
            {
                "symbol": "BTCUSDT",
                "orderId": 28457,
                "clientOrderId": "wlct-abc",
                "transactTime": 1_700_000_000_000,
                "price": "50000.00",
                "origQty": "0.01000000",
                "executedQty": "0.00000000",
                "cummulativeQuoteQty": "0.00000000",
                "status": "NEW",
                "timeInForce": "GTC",
                "type": "LIMIT",
                "side": "BUY",
                "fills": [],
            }
        )
        adapter, sent = self._adapter(
            [HttpResponse(status=200, headers={}, body=body)]
        )
        result = asyncio.run(adapter.submit_order(intent(), "wlct-abc"))

        assert result.accepted
        assert result.exchange_order_id == "28457"
        assert result.status is OrderStatus.ACKNOWLEDGED
        assert result.is_simulated is False

        request = sent[0]
        assert request.method == "POST"
        assert request.url.endswith("/api/v3/order")
        assert "symbol=BTCUSDT" in request.query
        assert "newClientOrderId=wlct-abc" in request.query
        assert "quantity=0.01" in request.query
        assert "timeInForce=GTC" in request.query
        assert "signature=" in request.query
        assert request.headers["X-MBX-APIKEY"] == FAKE_API_KEY

    def test_11_auth_and_rate_limit_statuses_map_to_the_right_failure_kind(
        self,
    ) -> None:
        # 401 and 403: definitive refusal, never ambiguous.
        for status in (401, 403):
            adapter, _ = self._adapter(
                [
                    HttpResponse(
                        status=status,
                        headers={},
                        body=json.dumps({"code": -2015, "msg": "Invalid API-key."}),
                    )
                ]
            )
            with pytest.raises(AdapterRejectedError) as excinfo:
                asyncio.run(adapter.submit_order(intent(), "wlct-a"))
            assert FAKE_API_SECRET not in str(excinfo.value)

        # 429: rate limited, with the venue's retry hint preserved.
        adapter, _ = self._adapter(
            [
                HttpResponse(
                    status=429,
                    headers={"Retry-After": "2"},
                    body=json.dumps({"code": -1003, "msg": "Too many requests."}),
                )
            ]
        )
        with pytest.raises(AdapterRateLimitedError) as rate_exc:
            asyncio.run(adapter.submit_order(intent(), "wlct-b"))
        assert rate_exc.value.retry_after_millis == 2_000

        # 418: an IP ban is still a rate-limit refusal, not a rejection.
        adapter, _ = self._adapter(
            [HttpResponse(status=418, headers={}, body=json.dumps({"code": -1003}))]
        )
        with pytest.raises(AdapterRateLimitedError):
            asyncio.run(adapter.submit_order(intent(), "wlct-c"))

    def test_12_a_5xx_is_ambiguous_and_a_4xx_is_definitive(self) -> None:
        adapter, _ = self._adapter(
            [HttpResponse(status=503, headers={}, body="Service Unavailable")]
        )
        with pytest.raises(AdapterConnectionError, match="UNKNOWN"):
            asyncio.run(adapter.submit_order(intent(), "wlct-d"))

        adapter, _ = self._adapter(
            [
                HttpResponse(
                    status=400,
                    headers={},
                    body=json.dumps({"code": -1013, "msg": "Filter failure: LOT_SIZE"}),
                )
            ]
        )
        with pytest.raises(AdapterRejectedError) as excinfo:
            asyncio.run(adapter.submit_order(intent(), "wlct-e"))
        assert excinfo.value.code == "-1013"

    def test_13_signed_requests_are_refused_against_the_public_mirror(self) -> None:
        clock = ExchangeClock(lambda: asyncio.sleep(0, result=0))

        async def send(request, timeout_ms: int):  # pragma: no cover - unreachable
            raise AssertionError("Nothing should be sent.")

        with pytest.raises(ValueError, match="market-data mirror"):
            BinanceTradingAdapter(
                send=send,
                credentials=StaticCredentialProvider([credentials()]),
                clock=clock,
                rest_base="https://data-api.binance.vision",
            )


# ======================================================================
# 14-15: order validation
# ======================================================================
class TestValidation:
    def test_14_validation_catches_every_class_of_bad_order(self) -> None:
        validator = OrderValidator()
        specification = spec()

        # Quantity below the venue minimum and notional below the floor.
        result = validator.validate(
            intent(quantity=Decimal("0.000001"), price=Decimal("50000")),
            specification=specification,
            reference_price=Decimal("50000"),
        )
        assert not result.valid
        codes = {issue.code for issue in result.issues}
        assert ValidationCode.LOT_SIZE_VIOLATION in codes

        # Price off the tick grid.
        result = validator.validate(
            intent(price=Decimal("50000.005")),
            specification=specification,
            reference_price=Decimal("50000"),
        )
        assert ValidationCode.TICK_SIZE_VIOLATION in {i.code for i in result.issues}

        # A limit order with no price.
        result = validator.validate(
            intent(price=None), specification=specification
        )
        assert ValidationCode.PRICE_REQUIRED in {i.code for i in result.issues}

        # Unknown symbol: refuse rather than guess the venue's rules.
        result = validator.validate(intent(), specification=None)
        assert ValidationCode.UNKNOWN_SYMBOL in {i.code for i in result.issues}

        # A halted symbol.
        result = validator.validate(
            intent(), specification=spec(is_tradeable=False)
        )
        assert ValidationCode.SYMBOL_NOT_TRADEABLE in {i.code for i in result.issues}

        # A valid order passes cleanly.
        assert validator.validate(
            intent(), specification=specification, reference_price=Decimal("50000")
        ).valid

    def test_15_the_fat_finger_price_band_catches_a_decimal_error(self) -> None:
        validator = OrderValidator(price_band_percent=Decimal("20"))
        # A misplaced decimal point: 5 000 instead of 50 000.
        result = validator.validate(
            intent(price=Decimal("5000.00")),
            specification=spec(),
            reference_price=Decimal("50000.00"),
        )
        assert not result.valid
        assert ValidationCode.PRICE_BAND_VIOLATION in {i.code for i in result.issues}

        # A deliberately passive order inside the band is fine.
        assert validator.validate(
            intent(price=Decimal("45000.00")),
            specification=spec(),
            reference_price=Decimal("50000.00"),
        ).valid


# ======================================================================
# 16-18: safety gates and live-trading defaults
# ======================================================================
class TestSafetyGates:
    def test_16_every_kill_switch_scope_blocks_submission(self) -> None:
        cases = [
            KillSwitchState(True, frozenset(), frozenset(), frozenset(), "halt"),
            KillSwitchState(
                False, frozenset({"BINANCE"}), frozenset(), frozenset(), None
            ),
            KillSwitchState(
                False, frozenset(), frozenset({"strategy-1"}), frozenset(), None
            ),
            KillSwitchState(
                False, frozenset(), frozenset(), frozenset({"BTC/USDT"}), None
            ),
        ]
        for switches in cases:
            decision = evaluate_safety_gates(
                ExecutionPreconditions(
                    exchange="BINANCE",
                    symbol="BTC/USDT",
                    strategy_id="strategy-1",
                    kill_switches=switches,
                    settings=paper_settings(),
                    risk_health=ComponentHealth.ok(),
                    market_data_health=ComponentHealth.ok(),
                    exchange_health=ComponentHealth.ok(),
                    is_simulated=True,
                )
            )
            assert not decision.allowed
            assert "KILL_SWITCH" in decision.blocking_gate.value

    def test_17_unhealthy_or_unknown_dependencies_fail_closed(self) -> None:
        # A default ComponentHealth means "unknown", and unknown blocks.
        decision = evaluate_safety_gates(
            ExecutionPreconditions(
                exchange="BINANCE",
                symbol="BTC/USDT",
                strategy_id=None,
                kill_switches=no_kill_switches(),
                settings=paper_settings(),
                is_simulated=True,
            )
        )
        assert not decision.allowed
        failed = {result.gate.value for result in decision.failures}
        assert "RISK_ENGINE_HEALTHY" in failed
        assert "MARKET_DATA_HEALTHY" in failed

        # Stale risk state counts as unavailable.
        decision = evaluate_safety_gates(
            ExecutionPreconditions(
                exchange="BINANCE",
                symbol="BTC/USDT",
                strategy_id=None,
                kill_switches=no_kill_switches(),
                settings=paper_settings(),
                risk_health=ComponentHealth.ok(age_micros=60_000_000),
                market_data_health=ComponentHealth.ok(),
                exchange_health=ComponentHealth.ok(),
                is_simulated=True,
            )
        )
        assert not decision.allowed

    def test_18_live_trading_is_off_by_default_and_contradictions_are_rejected(
        self,
    ) -> None:
        # An empty environment must never yield a transmitting configuration.
        default = ExecutionSettings.from_env({})
        assert default.live_trading_enabled is False
        assert default.dry_run is True
        assert default.paper_trading is True
        assert default.will_transmit_orders is False
        assert default.trading_mode is TradingMode.DISABLED

        # A garbled boolean is an error, never a silent False.
        with pytest.raises(Exception, match="boolean"):
            ExecutionSettings.from_env({"LIVE_TRADING_ENABLED": "ture"})

        # LIVE + DRY_RUN is a contradiction and is refused, not resolved.
        with pytest.raises(UnsafeExecutionConfiguration, match="contradict"):
            ExecutionSettings(
                live_trading_enabled=True,
                dry_run=True,
                paper_trading=False,
                trading_mode_setting="LIVE",
                trading_enabled=True,
                live_trading_confirmed=True,
            )

        # LIVE without the corroborating flags is refused too.
        with pytest.raises(UnsafeExecutionConfiguration, match="TRADING_MODE=LIVE"):
            ExecutionSettings(
                live_trading_enabled=True,
                dry_run=False,
                paper_trading=False,
                trading_mode_setting="PAPER",
                trading_enabled=True,
                live_trading_confirmed=True,
            )

        # And the only combination that transmits requires all five.
        live = ExecutionSettings(
            live_trading_enabled=True,
            dry_run=False,
            paper_trading=False,
            trading_mode_setting="LIVE",
            trading_enabled=True,
            live_trading_confirmed=True,
        )
        assert live.will_transmit_orders is True


# ======================================================================
# 19-24: the engine pipeline
# ======================================================================
class TestExecutionEngine:
    def test_19_a_clean_order_is_submitted_and_recorded(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, store, _ = build_engine(adapter)
        result = asyncio.run(engine.submit(intent(), healthy_context()))

        assert result.outcome is ExecutionOutcome.ACCEPTED
        assert result.order is not None
        assert result.order.status is OrderStatus.ACKNOWLEDGED
        assert result.order.exchange_order_id == "28457"
        assert len(adapter.submit_calls) == 1
        # The deterministic client order id reached the venue.
        assert adapter.submit_calls[0][1] == result.client_order_id
        assert result.client_order_id.startswith("wlct-")
        stored = asyncio.run(
            store.get_by_client_order_id("tenant-1", result.client_order_id)
        )
        assert stored is not None

    def test_20_duplicate_submission_is_prevented_and_nothing_is_sent(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, store, _ = build_engine(adapter)
        first = asyncio.run(engine.submit(intent(), healthy_context()))
        second = asyncio.run(engine.submit(intent(), healthy_context()))

        assert first.outcome is ExecutionOutcome.ACCEPTED
        assert second.outcome is ExecutionOutcome.DUPLICATE
        assert second.error_code is ExecutionErrorCode.DUPLICATE_ORDER
        # The venue was contacted exactly once.
        assert len(adapter.submit_calls) == 1
        assert store.order_count() == 1

    def test_21_an_ambiguous_result_is_never_resubmitted(self) -> None:
        adapter = StubTradingAdapter(
            error=AdapterConnectionError("connection reset")
        )
        engine, store, incidents = build_engine(adapter)
        result = asyncio.run(engine.submit(intent(), healthy_context()))

        assert result.outcome is ExecutionOutcome.UNKNOWN
        assert result.error_code is ExecutionErrorCode.RESULT_UNKNOWN
        assert result.requires_reconciliation
        assert result.transmitted is True
        # Exactly one attempt: no retry, ever.
        assert len(adapter.submit_calls) == 1
        # The order is flagged, and its status is the honest SUBMITTED.
        assert result.order is not None
        assert result.order.status is OrderStatus.SUBMITTED
        state = asyncio.run(
            store.get_reconciliation_state("tenant-1", result.order.order_id)
        )
        assert state is ReconciliationState.UNKNOWN
        assert state.blocks_further_submission
        # A critical incident exists.
        raised = incidents.of_type(IncidentType.UNKNOWN_ORDER_RESULT)
        assert len(raised) == 1
        assert raised[0].requires_paging

    def test_22_dry_run_builds_everything_and_transmits_nothing(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, _store, _ = build_engine(
            adapter,
            settings=ExecutionSettings(
                live_trading_enabled=False,
                dry_run=True,
                paper_trading=False,
                trading_mode_setting="PAPER",
                trading_enabled=True,
            ),
        )
        result = asyncio.run(engine.submit(intent(), healthy_context()))

        assert result.outcome is ExecutionOutcome.DRY_RUN
        assert result.transmitted is False
        assert adapter.submit_calls == []
        # It must never be reported as submitted.
        assert result.order is not None
        assert result.order.status is not OrderStatus.SUBMITTED
        assert "NOT" in result.message

    def test_23_risk_failure_blocks_the_order_and_fails_closed(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, _store, _ = build_engine(adapter)

        # An incomplete risk snapshot must block.
        result = asyncio.run(
            engine.submit(
                intent(), healthy_context(snapshot=snapshot(is_complete=False))
            )
        )
        assert result.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert result.error_code in (
            ExecutionErrorCode.RISK_UNAVAILABLE,
            ExecutionErrorCode.RISK_REJECTED,
        )
        assert adapter.submit_calls == []

        # A risk engine that raises must also block, not bypass.
        class ExplodingRisk:
            def evaluate(self, *args: Any, **kwargs: Any):
                raise RuntimeError("risk store unreachable")

        exploding = ExecutionEngine(
            adapter=adapter,
            settings=paper_settings(),
            risk_engine=ExplodingRisk(),  # type: ignore[arg-type]
            store=InMemoryOrderStore(),
            locks=InMemoryLockManager(),
            incidents=InMemoryIncidentRecorder(),
        )
        result = asyncio.run(exploding.submit(intent(), healthy_context()))
        assert result.error_code is ExecutionErrorCode.RISK_UNAVAILABLE
        assert adapter.submit_calls == []

    def test_24_paper_trading_cannot_reach_a_real_endpoint(self) -> None:
        """A simulated adapter is structurally incapable of transmitting.

        And the reverse is also enforced: a live configuration refuses to start
        against a simulator, so a paper adapter can never be presented as live.
        """
        from wlct_trading.adapters.paper import PaperTradingAdapter

        paper = PaperTradingAdapter(lambda exchange, symbol: None)
        assert paper.is_simulated is True

        engine, _store, _ = build_engine(paper)  # type: ignore[arg-type]
        result = asyncio.run(engine.submit(intent(), healthy_context()))
        # No book, so no invented fill — and nothing left the process.
        assert result.transmitted is False
        assert result.is_simulated is True

        with pytest.raises(EngineConfigurationError, match="simulator"):
            ExecutionEngine(
                adapter=paper,  # type: ignore[arg-type]
                settings=ExecutionSettings(
                    live_trading_enabled=True,
                    dry_run=False,
                    paper_trading=False,
                    trading_mode_setting="LIVE",
                    trading_enabled=True,
                    live_trading_confirmed=True,
                ),
                risk_engine=risk_engine(),
                store=InMemoryOrderStore(),
                locks=InMemoryLockManager(),
                incidents=InMemoryIncidentRecorder(),
            )


# ======================================================================
# 25-26: state transitions and fills
# ======================================================================
class TestStateAndFills:
    def test_25_illegal_transitions_are_refused_and_recorded(self) -> None:
        order = Order.from_intent(intent(), client_order_id="wlct-x")
        order.transition_to(OrderStatus.SUBMITTED, reason="sent")
        order.transition_to(OrderStatus.ACKNOWLEDGED, reason="ack")
        order.transition_to(OrderStatus.FILLED, reason="done")
        assert order.is_terminal

        # A terminal order cannot go back to open.
        from wlct_trading.orders import InvalidOrderTransition

        with pytest.raises(InvalidOrderTransition):
            order.transition_to(OrderStatus.PARTIALLY_FILLED, reason="impossible")
        assert order.try_transition_to(OrderStatus.CANCELLED, reason="no") is None
        # State is unchanged: history was not rewritten.
        assert order.status is OrderStatus.FILLED

    def test_26_fills_normalise_deduplicate_and_move_the_position(self) -> None:
        positions = PositionManager()
        adapter = StubTradingAdapter(
            result=accepted_result(
                status=OrderStatus.FILLED,
                fills=(
                    Fill(
                        fill_id="28457:1",
                        order_id="ignored",
                        trade_id="1",
                        price=Decimal("50000.00"),
                        quantity=Decimal("0.01"),
                        fee=Decimal("0.5"),
                        fee_currency="USDT",
                        is_maker=False,
                        is_simulated=False,
                        exchange_timestamp=1_700_000_000_000_000,
                        symbol="BTC/USDT",
                        side=OrderSide.BUY,
                        exchange=ExchangeId.BINANCE,
                        quote_quantity=Decimal("500.00"),
                        exchange_order_id="28457",
                    ),
                ),
            )
        )
        engine, store, _ = build_engine(adapter, positions=positions)
        result = asyncio.run(engine.submit(intent(), healthy_context()))

        assert result.outcome is ExecutionOutcome.ACCEPTED
        assert len(result.fills) == 1
        assert result.order is not None
        assert result.order.filled_quantity == Decimal("0.01")
        assert result.order.average_fill_price == Decimal("50000.00")

        position = positions.get("account-1", ExchangeId.BINANCE, "BTC/USDT")
        assert position is not None
        assert position.quantity == Decimal("0.01")

        # The same fill arriving again by another route changes nothing.
        applied, _update = asyncio.run(
            engine.apply_external_fill(result.order, result.fills[0])
        )
        assert applied is False
        assert result.order.filled_quantity == Decimal("0.01")
        assert positions.get(
            "account-1", ExchangeId.BINANCE, "BTC/USDT"
        ).quantity == Decimal("0.01")


# ======================================================================
# 27-28: reconciliation
# ======================================================================
class TestReconciliation:
    def test_27_an_unknown_order_is_resolved_by_querying_the_venue(self) -> None:
        # First: the order exists at the venue and was filled while we were blind.
        local = Order.from_intent(intent(), client_order_id="wlct-unknown")
        local.transition_to(OrderStatus.SUBMITTED, reason="sent")

        venue_view = Order.from_intent(intent(), client_order_id="wlct-unknown")
        venue_view.transition_to(OrderStatus.SUBMITTED, reason="v")
        venue_view.transition_to(OrderStatus.ACKNOWLEDGED, reason="v")
        venue_view.apply_fill(
            Fill(
                fill_id="99:7",
                order_id=venue_view.order_id,
                trade_id="7",
                price=Decimal("50000.00"),
                quantity=Decimal("0.01"),
                fee=Decimal("0.5"),
                fee_currency="USDT",
                is_maker=True,
                is_simulated=False,
                exchange_timestamp=1_700_000_000_000_000,
                symbol="BTC/USDT",
                side=OrderSide.BUY,
                exchange=ExchangeId.BINANCE,
            )
        )

        store = InMemoryOrderStore()
        asyncio.run(store.save_order(local))
        asyncio.run(
            store.set_reconciliation_state(
                "tenant-1", local.order_id, ReconciliationState.UNKNOWN
            )
        )
        service = ReconciliationService(
            trading=StubTradingAdapter(lookup=venue_view),  # type: ignore[arg-type]
            account=StubAccountAdapter(),  # type: ignore[arg-type]
            store=store,
            incidents=InMemoryIncidentRecorder(),
            locks=InMemoryLockManager(),
            positions=PositionManager(),
        )
        resolved, discrepancy = asyncio.run(service.resolve_unknown_order(local))
        assert discrepancy is not None
        assert resolved.filled_quantity == Decimal("0.01")
        assert (
            asyncio.run(store.get_reconciliation_state("tenant-1", local.order_id))
            is ReconciliationState.IN_SYNC
        )

        # Second: the venue has never heard of it, so it was never placed.
        orphan = Order.from_intent(
            intent(quantity=Decimal("0.02")), client_order_id="wlct-orphan"
        )
        orphan.transition_to(OrderStatus.SUBMITTED, reason="sent")
        store2 = InMemoryOrderStore()
        asyncio.run(store2.save_order(orphan))
        service2 = ReconciliationService(
            trading=StubTradingAdapter(lookup=None),  # type: ignore[arg-type]
            account=StubAccountAdapter(),  # type: ignore[arg-type]
            store=store2,
            incidents=InMemoryIncidentRecorder(),
            locks=InMemoryLockManager(),
        )
        resolved2, discrepancy2 = asyncio.run(service2.resolve_unknown_order(orphan))
        assert resolved2.status is OrderStatus.FAILED
        assert discrepancy2 is not None
        assert discrepancy2.repaired is True

    def test_28_an_order_we_did_not_place_is_never_adopted(self) -> None:
        foreign = Order.from_intent(
            intent(quantity=Decimal("5")), client_order_id="someone-elses-order"
        )
        foreign.transition_to(OrderStatus.SUBMITTED, reason="v")
        foreign.transition_to(OrderStatus.ACKNOWLEDGED, reason="v")

        store = InMemoryOrderStore()
        incidents = InMemoryIncidentRecorder()
        service = ReconciliationService(
            trading=StubTradingAdapter(open_orders=(foreign,)),  # type: ignore[arg-type]
            account=StubAccountAdapter(),  # type: ignore[arg-type]
            store=store,
            incidents=incidents,
            locks=InMemoryLockManager(),
        )
        report = asyncio.run(
            service.reconcile_account("tenant-1", "account-1", check_positions=False)
        )
        assert report.succeeded
        types = {item.discrepancy_type.value for item in report.discrepancies}
        assert "ORDER_MISSING_LOCALLY" in types
        # Not adopted: the local store is still empty.
        assert store.order_count() == 0
        # And it escalated.
        assert incidents.of_type(IncidentType.UNEXPECTED_ORDER)


# ======================================================================
# 29-30: the private user-data stream
# ======================================================================
class TestPrivateStream:
    def test_29_every_private_stream_event_type_parses(self) -> None:
        report = parse_user_stream_message(
            json.dumps(
                {
                    "e": "executionReport",
                    "E": 1_700_000_000_000,
                    "s": "BTCUSDT",
                    "c": "wlct-abc",
                    "S": "BUY",
                    "o": "LIMIT",
                    "f": "GTC",
                    "q": "0.01000000",
                    "p": "50000.00000000",
                    "X": "PARTIALLY_FILLED",
                    "x": "TRADE",
                    "i": 28457,
                    "l": "0.00500000",
                    "z": "0.00500000",
                    "L": "50000.00000000",
                    "n": "0.25000000",
                    "N": "USDT",
                    "T": 1_700_000_000_100,
                    "t": 12345,
                    "m": True,
                    "Z": "250.00000000",
                    "r": "NONE",
                }
            )
        )
        assert report.event_type is UserStreamEventType.EXECUTION_REPORT
        execution = report.execution
        assert execution is not None
        assert execution.is_trade
        assert execution.status is OrderStatus.PARTIALLY_FILLED
        assert execution.last_filled_quantity == Decimal("0.00500000")
        assert isinstance(execution.last_filled_price, Decimal)

        fill = execution.to_fill(order_id="order-1", symbol="BTC/USDT")
        assert fill.fill_id == "28457:12345"
        assert fill.is_simulated is False
        assert fill.side is OrderSide.BUY
        assert fill.fee == Decimal("0.25000000")

        # A non-trade report must never become a fill.
        cancelled = parse_user_stream_message(
            json.dumps(
                {
                    "e": "executionReport",
                    "E": 1_700_000_000_000,
                    "s": "BTCUSDT",
                    "c": "cancel-request-id",
                    "C": "wlct-abc",
                    "S": "BUY",
                    "X": "CANCELED",
                    "x": "CANCELED",
                    "i": 28457,
                    "q": "0.01",
                    "z": "0",
                    "l": "0",
                    "L": "0",
                    "Z": "0",
                    "n": "0",
                    "T": 1_700_000_000_100,
                    "t": -1,
                    "m": False,
                }
            )
        )
        assert cancelled.execution is not None
        assert cancelled.execution.is_trade is False
        # The cancelled order is identified by origClientOrderId, not clientOrderId.
        assert cancelled.execution.effective_client_order_id == "wlct-abc"
        with pytest.raises(ValueError, match="fabricate"):
            cancelled.execution.to_fill(order_id="order-1", symbol="BTC/USDT")

        balances = parse_user_stream_message(
            json.dumps(
                {
                    "e": "outboundAccountPosition",
                    "E": 1_700_000_000_000,
                    "u": 1_700_000_000_000,
                    "B": [
                        {"a": "USDT", "f": "1000.00", "l": "250.00"},
                        {"a": "BTC", "f": "0.50", "l": "0.00"},
                    ],
                }
            )
        )
        assert balances.balances is not None
        assert len(balances.balances.balances) == 2
        usdt = balances.balances.balances[0]
        assert usdt.free == Decimal("1000.00")
        assert usdt.locked == Decimal("250.00")
        assert usdt.total == Decimal("1250.00")

        delta = parse_user_stream_message(
            json.dumps(
                {
                    "e": "balanceUpdate",
                    "E": 1_700_000_000_000,
                    "a": "BTC",
                    "d": "-0.05000000",
                    "T": 1_700_000_000_000,
                }
            )
        )
        assert delta.balance_delta is not None
        assert delta.balance_delta.delta == Decimal("-0.05000000")

        expired = parse_user_stream_message(
            json.dumps({"e": "listenKeyExpired", "E": 1_700_000_000_000})
        )
        assert expired.event_type is UserStreamEventType.LISTEN_KEY_EXPIRED

        # An unmodelled event is surfaced, not silently dropped.
        unknown = parse_user_stream_message(json.dumps({"e": "somethingNew"}))
        assert unknown.event_type is UserStreamEventType.UNKNOWN
        assert unknown.raw_event_name == "somethingNew"

    def test_30_the_listen_key_is_managed_and_never_exposed(self) -> None:
        secret_key = "pqia91ma19a5s61cv6a81va65sdf19v8a65a1a5s61cv6a81va65sdf19v8a65a1"
        created: list[str] = []
        renewed: list[str] = []
        closed: list[str] = []

        async def create() -> str:
            created.append(secret_key)
            return secret_key

        async def keepalive(key: str) -> None:
            renewed.append(key)

        async def close(key: str) -> None:
            closed.append(key)

        manager = ListenKeyManager(
            create=create,
            keepalive=keepalive,
            close=close,
            testnet=True,
            refresh_interval_millis=1_800_000,
        )

        url = asyncio.run(manager.acquire())
        assert url.startswith("wss://")
        assert secret_key in url  # the URL legitimately carries it
        # But nothing else does.
        assert secret_key not in manager.masked_key
        assert secret_key not in json.dumps(manager.status())
        assert secret_key not in mask_listen_key(secret_key)
        assert manager.has_key

        assert asyncio.run(manager.renew()) is True
        assert renewed == [secret_key]
        assert manager.renewal_count == 1

        # An expiry event discards the key without contacting the venue.
        manager.invalidate()
        assert manager.has_key is False
        assert closed == []

        # A plaintext socket is refused: the URL contains the key.
        with pytest.raises(ValueError, match="wss"):
            ListenKeyManager(
                create=create,
                keepalive=keepalive,
                close=close,
                ws_base="ws://stream.binance.com:9443",
            )
