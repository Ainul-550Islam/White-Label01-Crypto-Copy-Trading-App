"""Paper-trading venue.

A simulated matching engine used to exercise the full order path - strategy,
risk, OMS, position tracking - without sending anything to a real exchange.

Honesty rules, enforced structurally rather than by convention:

* ``is_simulated`` is ``True`` on the adapter, on every :class:`SubmitResult`
  and on every :class:`Fill` it produces. The OMS copies that flag onto the
  order and the position manager onto the position, so a simulated result
  cannot be displayed or reported as a real one anywhere downstream.
* Fills are produced only against **real observed market data**. The adapter is
  given a live top-of-book and will not invent a price. If no usable book is
  available the order simply rests unfilled - it never fabricates an execution.
* Marketable orders cross the real spread and are filled at the real touch
  price, capped by the real resting quantity, so the simulation inherits the
  actual liquidity conditions rather than assuming infinite depth.

This is a simulator and is labelled as one. It models neither queue position
nor market impact, so its fills are optimistic relative to live trading.

Where the fill rules live
-------------------------
The matching rules themselves are **not** implemented here. They live in
:class:`~wlct_trading.backtest.simulator.SimulatedMatchingEngine`, which is the
one implementation shared by this adapter and by the backtest engine. Two
copies of "when does a simulated order fill" would eventually disagree, and the
difference between paper results and backtest results would then be an artefact
of the code rather than of the market. This class configures that engine with
assumptions that reproduce the adapter's established behaviour exactly -
immediate taker fill at the observed touch, capped by displayed size, no
slippage, no latency model - and adds the venue-shaped API around it.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import AsyncIterator, Callable

from wlct_trading.backtest.simulator import (
    ExecutionAssumptions,
    SimulatedIdFactory,
    SimulatedMatchingEngine,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderStatus
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.adapters.base import (
    AccountAdapter,
    AccountBalance,
    CancelResult,
    SubmitResult,
    TradingAdapter,
    VenueAccount,
    VenuePosition,
)

__all__ = ["PaperTradingAdapter", "PaperAccountAdapter", "BookProvider"]

_ZERO = Decimal(0)

#: Supplies the current real top-of-book for a symbol, or ``None`` when the
#: book is unavailable or untrustworthy.
BookProvider = Callable[[ExchangeId, str], BookTop | None]


class _EmptyFillStream(AsyncIterator[Fill]):
    """An ``AsyncIterator[Fill]`` that stops immediately, for adapters with
    no fill stream.

    The explicit ABC inheritance is load-bearing for the type gate: without a
    declared base, mypy must infer whether this class satisfies a Protocol it
    nominally claims in ``stream_fills``, and refuses to.

    A do-nothing async generator would read better but is either an
    unreachable ``yield`` or a plain function returning ``None``; both are
    lies of a kind the strict type gate is right to refuse.
    """

    __slots__ = ()

    def __aiter__(self) -> AsyncIterator[Fill]:
        return self

    async def __anext__(self) -> Fill:
        raise StopAsyncIteration


class PaperTradingAdapter(TradingAdapter):
    """Simulated order entry backed by real observed prices."""

    __slots__ = (
        "_book_provider",
        "_exchange",
        "_resting",
        "_fee_rate",
        "_fee_currency",
        "_engine",
    )

    def __init__(
        self,
        book_provider: BookProvider,
        *,
        exchange: ExchangeId = ExchangeId.PAPER,
        fee_rate: Decimal = Decimal("0.001"),
        fee_currency: str = "USDT",
    ) -> None:
        self._book_provider = book_provider
        self._exchange = exchange
        self._resting: dict[str, Order] = {}
        self._fee_rate = fee_rate
        self._fee_currency = fee_currency
        # Assumptions chosen to reproduce this adapter's historical behaviour
        # exactly: one fee rate for both sides, no slippage, no latency, fills
        # capped by displayed size, partial fills permitted.
        self._engine = SimulatedMatchingEngine(
            ExecutionAssumptions(
                maker_fee_rate=fee_rate,
                taker_fee_rate=fee_rate,
                slippage_bps=_ZERO,
                fee_currency=fee_currency,
                latency_micros=0,
                allow_partial_fills=True,
                cap_by_displayed_size=True,
                min_fill_quantity=_ZERO,
            ),
            # Random ids: this adapter runs against live data where
            # reproducibility is neither achievable nor expected. The backtest
            # engine supplies a deterministic factory instead.
            id_factory=SimulatedIdFactory(prefix="paper", deterministic=False),
            exchange=exchange,
        )

    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    @property
    def is_simulated(self) -> bool:
        return True

    @property
    def fee_rate(self) -> Decimal:
        return self._fee_rate

    @property
    def fee_currency(self) -> str:
        return self._fee_currency

    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        """Accept the order and fill it if the real book says it would cross."""
        now = epoch_micros()
        book = self._book_provider(intent.exchange, intent.symbol)
        exchange_order_id = f"paper-{uuid.uuid4().hex[:16]}"

        match = self._engine.submit(
            intent,
            client_order_id=client_order_id,
            order_id="",
            book=book,
            now_micros=now,
        )

        if match.rests:
            # This adapter has no book-update callback, so a resting order
            # would never be revisited. Dropping it from the engine keeps the
            # engine's resting book from growing without bound; the order is
            # still reported as ACKNOWLEDGED, exactly as before.
            self._engine.cancel(client_order_id)

        if not match.accepted:
            return SubmitResult(
                accepted=False,
                exchange_order_id=None,
                status=OrderStatus.REJECTED,
                rejection_code="SIMULATED_VALIDATION",
                rejection_reason=match.reason,
                is_simulated=True,
                submitted_at_micros=now,
                fills=(),
            )

        return SubmitResult(
            accepted=True,
            exchange_order_id=exchange_order_id,
            status=(
                OrderStatus.ACKNOWLEDGED if not match.fills else match.status
            ),
            is_simulated=True,
            submitted_at_micros=now,
            fills=match.fills,
        )

    async def cancel_order(self, order: Order) -> CancelResult:
        self._resting.pop(order.client_order_id, None)
        self._engine.cancel(order.client_order_id)
        return CancelResult(
            accepted=True,
            status=OrderStatus.CANCELLED,
            reason="Cancelled on the simulated venue.",
            is_simulated=True,
        )

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        return self._resting.get(client_order_id)

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        """Resting simulated orders for this account.

        Scoped by tenant and account even though the simulator is process-local:
        the reconciliation code path is shared with the live adapters, and a
        paper run that quietly ignored the scoping would not exercise the same
        behaviour it is meant to rehearse.
        """
        return tuple(
            order
            for order in self._resting.values()
            if order.tenant_id == tenant_id
            and order.account_id == account_id
            and (symbol is None or order.symbol == symbol)
        )

    async def exchange_time(self) -> int:
        """Local wall clock, in milliseconds.

        The simulated venue has no clock of its own, so the offset it reports is
        always zero. That is honest rather than convenient: there is genuinely
        no skew between this process and a venue running inside it.
        """
        return epoch_micros() // 1_000

    def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        """The simulator fills synchronously in ``submit_order``.

        There is therefore no asynchronous fill stream; this yields nothing.
        An immediate-stop iterator is used instead of an empty async
        generator because an async generator with no reachable ``yield`` is
        either dead code or a syntax error, and neither is honest.
        """
        return _EmptyFillStream()


class PaperAccountAdapter(AccountAdapter):
    """Account view for the simulated venue.

    Balances are configured by the operator rather than fetched, and are
    labelled simulated wherever they surface.
    """

    __slots__ = ("_exchange", "_balances")

    def __init__(
        self,
        balances: dict[str, Decimal] | None = None,
        *,
        exchange: ExchangeId = ExchangeId.PAPER,
    ) -> None:
        self._exchange = exchange
        self._balances = balances or {}

    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    async def fetch_balances(
        self, tenant_id: str, account_id: str
    ) -> tuple[AccountBalance, ...]:
        return tuple(
            AccountBalance(asset=asset, free=amount, locked=_ZERO)
            for asset, amount in sorted(self._balances.items())
        )

    async def fetch_positions(
        self, tenant_id: str, account_id: str
    ) -> tuple[VenuePosition, ...]:
        """The simulator holds no venue-side positions.

        Position state for paper trading is derived from simulated fills by the
        platform's own position manager, exactly as it is for live trading.
        """
        return ()

    async def fetch_account(self, tenant_id: str, account_id: str) -> VenueAccount:
        """Simulated account snapshot.

        ``can_withdraw`` is hard-coded ``False``: the simulator must never
        present itself as capable of moving funds, and a paper account that
        claimed withdrawal rights would be rejected by the platform's own
        safety check anyway.
        """
        return VenueAccount(
            exchange=self._exchange,
            balances=await self.fetch_balances(tenant_id, account_id),
            can_trade=True,
            can_withdraw=False,
            can_deposit=False,
            account_type="SIMULATED",
            updated_at_micros=epoch_micros(),
            maker_commission_bps=None,
            taker_commission_bps=None,
        )

    async def verify_credentials(
        self, tenant_id: str, account_id: str
    ) -> tuple[bool, str]:
        return (True, "Simulated venue; no credentials are required or stored.")
