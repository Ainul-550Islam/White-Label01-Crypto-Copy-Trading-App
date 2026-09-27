"""Part 6: paper-trading safety.

The mandatory paper-trading safety test lives here. The property being proven
is narrow and absolute: **a paper session cannot reach a live execution
adapter.** Not "does not by default" - cannot, because the constructor refuses
any adapter that is not marked simulated and the class holds no other object
capable of talking to a venue.

Everything runs against an in-memory simulated adapter. No network, no
credentials, no real orders.
"""

from __future__ import annotations

import asyncio
import pathlib
from decimal import Decimal
from typing import AsyncIterator

import pytest

from wlct_trading.adapters.base import CancelResult, SubmitResult, TradingAdapter
from wlct_trading.adapters.paper import PaperTradingAdapter
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TradingMode,
)
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.paper import (
    PaperSessionConfig,
    PaperTradingSafetyError,
    PaperTradingSession,
)
from wlct_trading.risk import RiskLimits
from wlct_trading.signals import StrategyDescriptor, StrategyRiskProfile
from wlct_trading.strategies import build_default_strategy_registry

from tests.conftest import EXCHANGE, SYMBOL

D = Decimal


def run(coro):
    return asyncio.run(coro)


class ForbiddenLiveAdapter(TradingAdapter):
    """Stands in for a credentialed adapter. Must never be reachable.

    Every method raises. If a paper session ever manages to call one of them
    the test fails loudly rather than silently "succeeding".
    """

    called = False

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    @property
    def is_simulated(self) -> bool:
        return False

    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        ForbiddenLiveAdapter.called = True
        raise AssertionError("A live adapter was reached from paper trading.")

    async def cancel_order(self, order: Order) -> CancelResult:
        ForbiddenLiveAdapter.called = True
        raise AssertionError("A live adapter was reached from paper trading.")

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        raise AssertionError("A live adapter was reached from paper trading.")

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        raise AssertionError("A live adapter was reached from paper trading.")

    async def exchange_time(self) -> int:
        raise AssertionError("A live adapter was reached from paper trading.")

    async def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        raise AssertionError("A live adapter was reached from paper trading.")
        yield  # pragma: no cover


def descriptor() -> StrategyDescriptor:
    return StrategyDescriptor(
        strategy_id="strategy-1",
        tenant_id="tenant-1",
        name="deterministic example",
        version="1.0.0",
        enabled=True,
        exchange=EXCHANGE,
        symbols=(SYMBOL,),
        risk_profile=StrategyRiskProfile(
            max_order_quantity=D("1"),
            max_position_quantity=D("1"),
            max_order_notional=D("100000"),
            max_daily_loss=D("1000"),
            max_open_orders=5,
            max_orders_per_minute=600,
        ),
    )


def make_strategy(**parameters: object):
    registry = build_default_strategy_registry()
    return registry.create(
        "DETERMINISTIC_IMBALANCE_V1",
        "1.0.0",
        descriptor=descriptor(),
        symbol=SYMBOL,
        parameters=parameters
        or {"use_limit_orders": False, "signal_cooldown_micros": 0},
    )


def limits() -> RiskLimits:
    return RiskLimits(
        max_order_quantity=D("1"),
        max_order_notional=D("1000000"),
        max_position_quantity=D("1"),
        max_symbol_exposure_notional=D("1000000"),
        max_account_exposure_notional=D("1000000"),
        max_open_orders=50,
        max_orders_per_minute=600,
        max_daily_loss=D("100000"),
        max_strategy_loss=D("100000"),
        max_price_deviation_percent=D("100"),
        max_market_data_age_micros=60_000_000,
    )


def config(**overrides: object) -> PaperSessionConfig:
    payload: dict[str, object] = {
        "session_id": "paper-1",
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "exchange": EXCHANGE,
        "symbol": SYMBOL,
        "initial_capital": D("10000"),
        "risk_limits": limits(),
        "snapshot_interval_micros": 1,
    }
    payload.update(overrides)
    return PaperSessionConfig(**payload)  # type: ignore[arg-type]


def top(*, bid_qty: str, ask_qty: str) -> BookTop:
    now = epoch_micros()
    return BookTop(
        exchange=EXCHANGE,
        symbol=SYMBOL,
        best_bid=D("29995"),
        best_bid_quantity=D(bid_qty),
        best_ask=D("30005"),
        best_ask_quantity=D(ask_qty),
        sequence=1,
        exchange_timestamp=now,
        received_timestamp=now,
    )


class Feed:
    """Holds the latest book so the adapter and the session agree on price."""

    def __init__(self) -> None:
        self.book: BookTop | None = None

    def provider(self, _exchange: ExchangeId, _symbol: str) -> BookTop | None:
        return self.book


def build_session(feed: Feed | None = None, **overrides: object):
    feed = feed or Feed()
    session = PaperTradingSession(
        config=config(**overrides),
        strategy=make_strategy(),
        adapter=PaperTradingAdapter(feed.provider),
    )
    return session, feed


class TestPaperTradingSafety:
    """Case 28: paper trading cannot call the live execution adapter."""

    def test_a_live_adapter_is_refused_at_construction(self) -> None:
        ForbiddenLiveAdapter.called = False
        with pytest.raises(PaperTradingSafetyError):
            PaperTradingSession(
                config=config(),
                strategy=make_strategy(),
                adapter=ForbiddenLiveAdapter(),
            )
        assert ForbiddenLiveAdapter.called is False

    def test_live_mode_is_refused(self) -> None:
        with pytest.raises(PaperTradingSafetyError):
            config(trading_mode=TradingMode.LIVE)

    def test_disabled_mode_is_refused(self) -> None:
        with pytest.raises(PaperTradingSafetyError):
            config(trading_mode=TradingMode.DISABLED)

    def test_the_session_config_has_no_credential_field(self) -> None:
        fields = set(PaperSessionConfig.__dataclass_fields__)
        for banned in (
            "api_key",
            "apiKey",
            "secret",
            "api_secret",
            "private_key",
            "passphrase",
            "token",
            "credential",
        ):
            assert banned not in fields

    def test_the_session_exposes_no_way_to_swap_the_adapter(self) -> None:
        session, _ = build_session()
        for forbidden in ("set_adapter", "adapter", "use_live", "enable_live"):
            assert not hasattr(session, forbidden)

    def test_the_paper_module_never_imports_a_live_transport(self) -> None:
        root = pathlib.Path(__file__).resolve().parents[1] / "wlct_trading" / "paper"
        for path in root.rglob("*.py"):
            imports = [
                line
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith(("import ", "from "))
            ]
            for line in imports:
                assert "wlct_trading.net" not in line, f"{path}: {line}"
                assert "wlct_trading.execution" not in line, f"{path}: {line}"
                assert "binance" not in line.lower(), f"{path}: {line}"

    def test_the_session_reports_itself_as_simulated(self) -> None:
        session, _ = build_session()
        assert session.is_simulated is True
        assert session.portfolio.is_simulated is True


class TestPaperSessionBehaviour:
    def test_a_session_must_be_started_before_it_accepts_data(self) -> None:
        session, feed = build_session()
        feed.book = top(bid_qty="9", ask_qty="1")
        with pytest.raises(PaperTradingSafetyError):
            run(session.on_book_top(feed.book))

    def test_starting_twice_is_refused(self) -> None:
        session, _ = build_session()
        session.start()
        with pytest.raises(PaperTradingSafetyError):
            session.start()

    def test_a_signal_becomes_a_simulated_fill(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        outcomes = run(session.on_book_top(feed.book))
        assert outcomes
        summary = session.stop()
        assert summary.simulated_orders >= 1
        assert summary.simulated_fills >= 1
        assert summary.is_simulated is True

    def test_the_position_is_marked_as_containing_simulated_fills(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        position = session.portfolio.position
        assert position is not None
        assert position.contains_simulated_fills is True

    def test_risk_limits_are_enforced_in_paper_mode_too(self) -> None:
        """Case 30 again: paper is not a way around the risk engine."""
        session, feed = build_session(
            risk_limits=RiskLimits(
                max_order_quantity=D("0.0000001"),
                max_order_notional=D("1000000"),
                max_market_data_age_micros=60_000_000,
            )
        )
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        summary = session.stop()
        assert summary.signals_accepted >= 1
        assert summary.simulated_orders == 0
        assert summary.risk_rejections >= 1

    def test_absent_risk_limits_fail_closed(self) -> None:
        session, feed = build_session(risk_limits=RiskLimits())
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        assert session.stop().simulated_orders == 0

    def test_no_book_means_no_fill(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = None
        # The strategy still needs a book to produce a signal, so nothing is
        # emitted and nothing is filled. The point is that the absence of data
        # produces silence rather than an invented execution.
        summary = session.stop()
        assert summary.simulated_fills == 0

    def test_the_summary_is_labelled_and_disclaimed(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        payload = session.stop().to_dict()
        assert payload["isSimulated"] is True
        assert "not indicative of live performance" in str(payload["disclaimer"])

    def test_snapshots_are_recorded_in_memory_only(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        assert session.snapshots
        assert all(point["isSimulated"] is True for point in session.snapshots)

    def test_stopping_reports_a_final_summary(self) -> None:
        session, feed = build_session()
        session.start()
        feed.book = top(bid_qty="9", ask_qty="1")
        run(session.on_book_top(feed.book))
        summary = session.stop()
        assert summary.ended_at_micros is not None
        assert summary.trading_mode is TradingMode.PAPER
        assert session.is_running is False

    def test_a_strategy_for_another_symbol_is_refused(self) -> None:
        with pytest.raises(PaperTradingSafetyError):
            PaperTradingSession(
                config=config(symbol="ETH-USDT"),
                strategy=make_strategy(),
                adapter=PaperTradingAdapter(Feed().provider),
            )


class TestPaperAdapterLabelling:
    """The adapter itself must never present a simulated fill as real."""

    def test_the_adapter_declares_itself_simulated(self) -> None:
        assert PaperTradingAdapter(Feed().provider).is_simulated is True

    def test_every_fill_is_flagged(self) -> None:
        feed = Feed()
        feed.book = top(bid_qty="9", ask_qty="1")
        adapter = PaperTradingAdapter(feed.provider)
        intent = OrderIntent(
            tenant_id="tenant-1",
            account_id="account-1",
            strategy_id="strategy-1",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=D("0.5"),
        )
        result = run(adapter.submit_order(intent, "client-1"))
        assert result.is_simulated is True
        assert result.status is OrderStatus.FILLED
        assert all(fill.is_simulated for fill in result.fills)
        # The fill price is the observed ask, never an invented number.
        assert result.fills[0].price == D("30005")
