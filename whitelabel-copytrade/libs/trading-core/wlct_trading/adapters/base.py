"""Generic exchange adapter contracts.

These four protocols are the boundary between the platform and any venue.
Everything above them - strategies, the risk engine, the OMS, the position
manager - is written against these types only, so adding a venue means writing
one adapter and changing nothing else. Conversely, no venue-specific string,
field name or quirk is permitted to appear above this boundary.

The split into four narrow interfaces is deliberate:

``MarketDataAdapter``
    Read-only public data. Needs no credentials at all, so the market-data
    service can run without ever holding a key.
``TradingAdapter``
    Order placement and cancellation. The only interface that can move money.
``AccountAdapter``
    Balances, positions and account configuration.
``ExchangeAdapter``
    Composes the three plus venue metadata.

A service is wired with only the interfaces it needs. The market-data service
literally cannot place an order, because it never receives an object that has
the method.

Credentials
-----------
No method here accepts a raw API secret. Adapters are constructed with a
:class:`CredentialResolver` which returns a short-lived signing context from
the encrypted store. Secrets never appear in a signature, a log line, an
exception message or a repr.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import AsyncIterator, Protocol, runtime_checkable

from wlct_trading.enums import ExchangeId, MarketType, OrderStatus
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PublicTrade,
    SymbolRef,
    Ticker,
)
from wlct_trading.orders import Fill, Order, OrderIntent

__all__ = [
    "SymbolSpecification",
    "SubmitResult",
    "CancelResult",
    "AccountBalance",
    "VenuePosition",
    "VenueAccount",
    "CredentialResolver",
    "MarketDataAdapter",
    "TradingAdapter",
    "AccountAdapter",
    "ExchangeAdapter",
    "AdapterError",
    "AdapterConnectionError",
    "AdapterRejectedError",
    "AdapterRateLimitedError",
]


class AdapterError(Exception):
    """Base class for every adapter failure.

    Adapter exceptions must never carry credential material. Implementations
    include the venue's error code and message only.
    """


class AdapterConnectionError(AdapterError):
    """Network-level failure. The order's fate is UNKNOWN.

    This is the ambiguous case: the request may or may not have reached the
    venue. Callers must reconcile by client order id rather than assuming the
    order did not exist.
    """


class AdapterRejectedError(AdapterError):
    """The venue positively rejected the request. The order does not exist."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(f"{code}: {message}")


class AdapterRateLimitedError(AdapterError):
    """The venue rate-limited us. Carries the retry hint when one is given."""

    def __init__(self, retry_after_millis: int | None = None) -> None:
        self.retry_after_millis = retry_after_millis
        super().__init__(
            "Rate limited by venue"
            + (f"; retry after {retry_after_millis}ms." if retry_after_millis else ".")
        )


@dataclass(slots=True, frozen=True)
class SymbolSpecification:
    """Trading rules for one instrument.

    These are the venue's constraints. An order that violates them will be
    rejected by the venue, so the OMS validates against this locally first -
    a round trip saved and a rejection avoided.
    """

    symbol: str
    venue_symbol: str
    exchange: ExchangeId
    market_type: MarketType
    base_asset: str
    quote_asset: str
    price_tick: Decimal
    quantity_step: Decimal
    min_quantity: Decimal
    max_quantity: Decimal | None
    min_notional: Decimal
    is_tradeable: bool
    price_precision: int
    quantity_precision: int

    def validation_errors(self, quantity: Decimal, price: Decimal | None) -> list[str]:
        """Check an order against this venue's rules."""
        errors: list[str] = []
        if not self.is_tradeable:
            errors.append(f"{self.symbol} is not currently tradeable on {self.exchange.value}.")
        if quantity < self.min_quantity:
            errors.append(f"Quantity {quantity} is below the minimum {self.min_quantity}.")
        if self.max_quantity is not None and quantity > self.max_quantity:
            errors.append(f"Quantity {quantity} exceeds the maximum {self.max_quantity}.")
        if self.quantity_step > 0 and (quantity % self.quantity_step) != 0:
            errors.append(
                f"Quantity {quantity} is not a multiple of the step {self.quantity_step}."
            )
        if price is not None:
            if self.price_tick > 0 and (price % self.price_tick) != 0:
                errors.append(
                    f"Price {price} is not a multiple of the tick {self.price_tick}."
                )
            if quantity * price < self.min_notional:
                errors.append(
                    f"Notional {quantity * price} is below the minimum {self.min_notional}."
                )
        return errors


@dataclass(slots=True, frozen=True)
class SubmitResult:
    """What the venue said when we submitted an order."""

    accepted: bool
    exchange_order_id: str | None
    status: OrderStatus
    rejection_code: str | None = None
    rejection_reason: str | None = None
    is_simulated: bool = False
    submitted_at_micros: int = 0
    fills: tuple[Fill, ...] = field(default_factory=tuple)


@dataclass(slots=True, frozen=True)
class CancelResult:
    """Outcome of a cancellation request."""

    accepted: bool
    status: OrderStatus
    reason: str | None = None
    is_simulated: bool = False


@dataclass(slots=True, frozen=True)
class AccountBalance:
    asset: str
    free: Decimal
    locked: Decimal

    @property
    def total(self) -> Decimal:
        return self.free + self.locked


@dataclass(slots=True, frozen=True)
class VenuePosition:
    """A position as the *venue* reports it.

    Kept distinct from our internally derived ``Position`` so reconciliation
    can compare the two and surface a divergence instead of overwriting our
    fill-derived state with a venue snapshot.
    """

    symbol: str
    quantity: Decimal
    entry_price: Decimal | None
    unrealised_pnl: Decimal | None
    leverage: Decimal | None


@dataclass(slots=True, frozen=True)
class VenueAccount:
    """A normalised account snapshot as the venue reports it.

    Holds the permission flags alongside the balances because the two are read
    from the same endpoint and are only meaningful together: a balance is not
    safe to trade against if the key that read it also has withdrawal rights.

    Contains no credential material — only what the venue says about the
    account, which is safe to persist and to show an operator.
    """

    exchange: ExchangeId
    balances: tuple[AccountBalance, ...]
    can_trade: bool
    can_withdraw: bool
    can_deposit: bool
    account_type: str
    #: Venue-reported update time in microseconds, when available.
    updated_at_micros: int | None = None
    #: Maker/taker commission in basis points, when the venue reports them.
    maker_commission_bps: Decimal | None = None
    taker_commission_bps: Decimal | None = None

    def balance_for(self, asset: str) -> AccountBalance | None:
        upper = asset.upper()
        for balance in self.balances:
            if balance.asset.upper() == upper:
                return balance
        return None

    @property
    def non_zero_balances(self) -> tuple[AccountBalance, ...]:
        """Balances worth showing. A venue returns hundreds of zeroes."""
        return tuple(balance for balance in self.balances if balance.total != 0)

    @property
    def is_safe_for_trading(self) -> bool:
        """Whether this account may be traded at all.

        Withdrawal capability disqualifies it. The platform is non-custodial;
        a key that can move funds off the exchange is a liability it refuses to
        hold, no matter how convenient.
        """
        return self.can_trade and not self.can_withdraw


@runtime_checkable
class CredentialResolver(Protocol):
    """Supplies decrypted signing material for an account, just in time.

    Implementations read from the envelope-encrypted store and must return a
    short-lived object. Nothing in the trading core ever persists, logs or
    copies what this returns.
    """

    async def signing_context(self, tenant_id: str, account_id: str) -> object:
        ...


class MarketDataAdapter(ABC):
    """Public market data. Requires no credentials."""

    @property
    @abstractmethod
    def exchange(self) -> ExchangeId:
        ...

    @abstractmethod
    async def load_symbols(self) -> tuple[SymbolSpecification, ...]:
        """Fetch the venue's instrument list and trading rules."""

    @abstractmethod
    async def fetch_order_book_snapshot(
        self, symbol: SymbolRef, depth: int
    ) -> OrderBookSnapshot:
        """Fetch a depth image, used to initialise or resync a book."""

    @abstractmethod
    def stream_order_book(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[OrderBookDelta]:
        """Yield normalised incremental depth updates.

        Declared as a plain method returning an ``AsyncIterator`` because every
        implementation is an async *generator* (``async def`` containing
        ``yield``): calling one produces the iterator without an
        ``await``. An ``async def`` on the interface would claim callers get a
        coroutine first, which none of them do.
        """

    @abstractmethod
    def stream_trades(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[PublicTrade]:
        """Yield normalised public trade prints. See
        :meth:`stream_order_book` for why this is not ``async def``."""

    @abstractmethod
    def stream_tickers(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[Ticker]:
        """Yield normalised ticker updates. See :meth:`stream_order_book`
        for why this is not ``async def``."""

    @abstractmethod
    async def fetch_candles(
        self, symbol: SymbolRef, interval: str, limit: int
    ) -> tuple[Candle, ...]:
        """Fetch historical bars."""


class TradingAdapter(ABC):
    """Order entry. The only interface that can move real money."""

    @property
    @abstractmethod
    def exchange(self) -> ExchangeId:
        ...

    @property
    @abstractmethod
    def is_simulated(self) -> bool:
        """Whether fills from this adapter are simulated rather than real.

        Propagated onto every ``Fill`` and ``Order`` so a paper result can
        never be presented as a real one.
        """

    @abstractmethod
    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        """Send an order.

        Implementations MUST forward ``client_order_id`` to the venue so a
        retry is deduplicated venue-side. Raise
        :class:`AdapterConnectionError` when the outcome is unknown, and
        :class:`AdapterRejectedError` only when the venue definitively refused.
        """

    @abstractmethod
    async def cancel_order(self, order: Order) -> CancelResult:
        """Cancel a resting order."""

    @abstractmethod
    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        """Look an order up by client order id.

        This is the reconciliation path after an ambiguous submission.
        """

    @abstractmethod
    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        """List every order the venue currently considers live.

        The venue's answer, not ours. Reconciliation compares this against the
        local record: an order open here but closed locally means we missed a
        fill, and an order open locally but absent here means we missed a
        terminal event. Either way the venue wins.
        """

    @abstractmethod
    async def exchange_time(self) -> int:
        """The venue's current time in **milliseconds**.

        Used to measure clock offset before signing. Kept on the trading
        interface rather than in a shared utility because each venue exposes it
        on its own endpoint with its own weight cost.
        """

    @abstractmethod
    def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        """Yield executions as the venue reports them. See
        :meth:`MarketDataAdapter.stream_order_book` for why this is not
        ``async def``."""


class AccountAdapter(ABC):
    """Balances, positions and account configuration."""

    @property
    @abstractmethod
    def exchange(self) -> ExchangeId:
        ...

    @abstractmethod
    async def fetch_balances(
        self, tenant_id: str, account_id: str
    ) -> tuple[AccountBalance, ...]:
        ...

    @abstractmethod
    async def fetch_positions(
        self, tenant_id: str, account_id: str
    ) -> tuple[VenuePosition, ...]:
        ...

    @abstractmethod
    async def fetch_account(self, tenant_id: str, account_id: str) -> "VenueAccount":
        """Full account snapshot: balances plus venue-declared permissions.

        Separate from :meth:`fetch_balances` because the permission flags are
        what let the platform refuse a withdrawal-capable key, and a caller that
        only wants balances should not have to know that.
        """

    @abstractmethod
    async def verify_credentials(self, tenant_id: str, account_id: str) -> tuple[bool, str]:
        """Check that the stored key works and has safe permissions.

        Returns ``(ok, detail)``. Implementations MUST refuse a key with
        withdrawal permission enabled: the platform is non-custodial and a
        withdrawal-capable key is an unacceptable liability.
        """


class ExchangeAdapter(ABC):
    """Composite handle for one venue."""

    @property
    @abstractmethod
    def exchange(self) -> ExchangeId:
        ...

    @property
    @abstractmethod
    def market_data(self) -> MarketDataAdapter:
        ...

    @property
    @abstractmethod
    def trading(self) -> TradingAdapter:
        ...

    @property
    @abstractmethod
    def account(self) -> AccountAdapter:
        ...

    @abstractmethod
    async def connect(self) -> None:
        ...

    @abstractmethod
    async def close(self) -> None:
        ...
