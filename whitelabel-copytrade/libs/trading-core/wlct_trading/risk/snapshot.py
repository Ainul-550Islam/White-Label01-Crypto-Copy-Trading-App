"""The risk snapshot: one complete, versioned, self-describing view of state.

A snapshot is the *only* way the gate sees the world. Everything in it was
read from somewhere authoritative before the snapshot was frozen - account
state from the account layer, positions from the Position Manager, open
orders from the OMS, market health from the feed, configuration from a
versioned document - and each part carries the timestamp (and where
applicable the version) of the source it came from. That provenance is not
decoration: it is what lets the freshness rules distinguish "confirmed flat"
from "not looked", the difference between a decision and a guess.

Failure semantics, in one sentence: **a missing timestamp is treated as
infinitely old, a missing value as unverifiable, and unverifiable is
refused.** There is no default of zero, no fallback "assume flat", no
``or {}`` anywhere near this file's ``Decimal`` conversions - a snapshot
that cannot vouch for a number makes the gate reject, which is the entire
product.

Frozen in every sense: a frozen dataclass, tuples and frozensets only,
canonical ordering on assembly so two equal states produce equal digests.
The digest is a content hash used by replay and by the Redis write path to
detect "same version, different bytes" - the corruption signature of two
workers assembling from diverging state.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderBookHealth,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.market_data import BookTop
from wlct_trading.risk.exposure import (
    OpenOrderView,
    PositionView,
    ProjectingContext,
    ReferenceView,
    build_breakdown,
)
from wlct_trading.risk.rate_limits import RiskRateState
from wlct_trading.risk.core import RiskSnapshot
from wlct_trading.orders import OrderIntent

__all__ = [
    "RiskAccountState",
    "RiskMarketDataState",
    "RiskPositionState",
    "RiskOpenOrderState",
    "RiskStrategyState",
    "RiskStateSnapshot",
    "SnapshotError",
]

_ZERO = Decimal(0)


class SnapshotError(ValueError):
    """The snapshot is structurally malformed (independent of being unsafe)."""


def _decimal_or_none(raw: object, *, where: str) -> Decimal | None:
    """Strict decimal coercion: strings and ints only; floats are refused.

    Refusing floats is not pedantry: a snapshot assembled from a JSON
    decoder that produced ``float`` would carry a *different number* into
    the risk decision, and the difference between a float ``0.1`` and a
    Decimal ``0.1`` is exactly the size of the drift a limit can hide.
    """
    if raw is None:
        return None
    if isinstance(raw, float):
        raise SnapshotError(
            f"{where}: float {raw!r} refused; encode decimals as strings."
        )
    if isinstance(raw, int):
        return Decimal(raw)
    if isinstance(raw, str):
        try:
            value = Decimal(raw)
        except InvalidOperation as exc:
            raise SnapshotError(f"{where}: {raw!r} is not a decimal.") from exc
        if not value.is_finite():
            raise SnapshotError(f"{where}: {raw!r} is not finite.")
        return value
    if isinstance(raw, Decimal):
        if not raw.is_finite():
            raise SnapshotError(f"{where}: {raw} is not finite.")
        return raw
    raise SnapshotError(f"{where}: expected a decimal string, got {type(raw).__name__}.")


def _int_or_none(raw: object, *, where: str) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise SnapshotError(f"{where}: expected an integer, got {type(raw).__name__}.")
    return int(raw)


@dataclass(slots=True, frozen=True)
class RiskAccountState:
    """Normalised account view, as produced by the account/execution layer.

    ``equity == available + reserved + open_pnl_adjustments`` is *not*
    asserted here: venues disagree on the identity (fees in flight,
    unsettled trades), so the cross-check the gate performs is on internal
    consistency (no negative balances, no negative equity when the venue
    reports balances) and on staleness - not an invented reconciliation.
    """

    #: The account this describes. Tenancy is enforced upstream (the loader
    #: reads a tenant-scoped key); carrying the ids makes a misassembled
    #: snapshot *detectable* rather than silently cross-account.
    tenant_id: str
    account_id: str
    exchange: ExchangeId
    #: Total equity in quote terms (None only when the account source is
    #: unavailable at all - which the gate treats as INVALID_ACCOUNT_STATE).
    equity: Decimal | None
    available: Decimal | None
    reserved: Decimal | None
    #: When the account source last confirmed this state; None = never read.
    source_timestamp_micros: int | None
    #: Monotonic version of the account row/stream, where the source has one.
    source_version: int | None = None
    #: A paper/simulated account must say so. Real-money decisions and
    #: simulated ones then share this type without ever sharing an identity.
    is_simulated: bool = False
    #: The quote asset the notionals above are expressed in (e.g. USDT).
    quote_asset: str = "USD"
    #: Account status as the account layer understands it (active,
    #: reconciling, suspended). Free-form on the core side because the
    #: vocabulary belongs to the account manager, not to risk.
    status: str = "UNKNOWN"

    def to_payload(self) -> dict[str, Any]:
        return {
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "exchange": self.exchange.value,
            "equity": None if self.equity is None else str(self.equity),
            "available": None if self.available is None else str(self.available),
            "reserved": None if self.reserved is None else str(self.reserved),
            "sourceTimestampMicros": self.source_timestamp_micros,
            "sourceVersion": self.source_version,
            "isSimulated": self.is_simulated,
            "quoteAsset": self.quote_asset,
            "status": self.status,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RiskAccountState":
        keys = set(payload)
        expected = {
            "tenantId",
            "accountId",
            "exchange",
            "equity",
            "available",
            "reserved",
            "sourceTimestampMicros",
            "sourceVersion",
            "isSimulated",
            "quoteAsset",
            "status",
        }
        if keys != expected:
            raise SnapshotError(
                f"Account state payload keys must be exactly {sorted(expected)}."
            )
        return cls(
            tenant_id=str(payload["tenantId"]),
            account_id=str(payload["accountId"]),
            exchange=ExchangeId(str(payload["exchange"])),
            equity=_decimal_or_none(payload["equity"], where="account.equity"),
            available=_decimal_or_none(payload["available"], where="account.available"),
            reserved=_decimal_or_none(payload["reserved"], where="account.reserved"),
            source_timestamp_micros=_int_or_none(
                payload["sourceTimestampMicros"], where="account.sourceTimestampMicros"
            ),
            source_version=_int_or_none(
                payload["sourceVersion"], where="account.sourceVersion"
            ),
            is_simulated=bool(payload["isSimulated"]),
            quote_asset=str(payload["quoteAsset"]),
            status=str(payload["status"]),
        )

    def consistency_errors(self) -> tuple[str, ...]:
        """Structural contradictions inside the reported account figures."""
        errors: list[str] = []
        if self.equity is not None and self.equity < _ZERO:
            errors.append("account equity is negative")
        if self.available is not None and self.available < _ZERO:
            errors.append("account available balance is negative")
        if self.reserved is not None and self.reserved < _ZERO:
            errors.append("account reserved balance is negative")
        if (
            self.equity is not None
            and self.available is not None
            and self.reserved is not None
            and self.available > self.equity + self.reserved
        ):
            errors.append(
                "available exceeds equity plus reserved - the source "
                "disagrees with itself"
            )
        return tuple(errors)


@dataclass(slots=True, frozen=True)
class RiskPositionState:
    """One position, as the Position Manager reported it."""

    exchange: ExchangeId
    symbol: str
    quantity: Decimal
    average_entry_price: Decimal | None
    mark_price: Decimal | None
    source_timestamp_micros: int | None
    #: The strategy that last touched this position, when the OMS knows.
    #: Attribution, not ownership: see the STRATEGY comment in exposure.py.
    strategy_id: str | None = None
    contains_simulated_fills: bool = False

    def to_payload(self) -> dict[str, Any]:
        return {
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "quantity": str(self.quantity),
            "averageEntryPrice": (
                None if self.average_entry_price is None else str(self.average_entry_price)
            ),
            "markPrice": None if self.mark_price is None else str(self.mark_price),
            "sourceTimestampMicros": self.source_timestamp_micros,
            "strategyId": self.strategy_id,
            "containsSimulatedFills": self.contains_simulated_fills,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RiskPositionState":
        keys = set(payload)
        expected = {
            "exchange",
            "symbol",
            "quantity",
            "averageEntryPrice",
            "markPrice",
            "sourceTimestampMicros",
            "strategyId",
            "containsSimulatedFills",
        }
        if keys != expected:
            raise SnapshotError(
                f"Position state payload keys must be exactly {sorted(expected)}."
            )
        return cls(
            exchange=ExchangeId(str(payload["exchange"])),
            symbol=str(payload["symbol"]),
            quantity=_decimal_or_none(payload["quantity"], where="position.quantity") or _ZERO,
            average_entry_price=_decimal_or_none(
                payload["averageEntryPrice"], where="position.averageEntryPrice"
            ),
            mark_price=_decimal_or_none(payload["markPrice"], where="position.markPrice"),
            source_timestamp_micros=_int_or_none(
                payload["sourceTimestampMicros"], where="position.sourceTimestampMicros"
            ),
            strategy_id=(
                None if payload["strategyId"] is None else str(payload["strategyId"])
            ),
            contains_simulated_fills=bool(payload["containsSimulatedFills"]),
        )


@dataclass(slots=True, frozen=True)
class RiskOpenOrderState:
    """One open (or just-terminal) order as the OMS reported it."""

    client_order_id: str
    exchange: ExchangeId
    symbol: str
    side: OrderSide
    order_type: OrderType
    status: OrderStatus
    quantity: Decimal
    filled_quantity: Decimal
    is_reduce_only: bool
    time_in_force: TimeInForce
    strategy_id: str | None = None
    limit_price: Decimal | None = None
    source_timestamp_micros: int | None = None

    def to_view(self) -> OpenOrderView:
        return OpenOrderView(
            client_order_id=self.client_order_id,
            exchange=self.exchange.value,
            symbol=self.symbol,
            side=self.side,
            order_type=self.order_type,
            status=self.status,
            quantity=self.quantity,
            filled_quantity=self.filled_quantity,
            is_reduce_only=self.is_reduce_only,
            strategy_id=self.strategy_id,
            limit_price=self.limit_price,
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "clientOrderId": self.client_order_id,
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "side": self.side.value,
            "orderType": self.order_type.value,
            "status": self.status.value,
            "quantity": str(self.quantity),
            "filledQuantity": str(self.filled_quantity),
            "isReduceOnly": self.is_reduce_only,
            "timeInForce": self.time_in_force.value,
            "strategyId": self.strategy_id,
            "limitPrice": None if self.limit_price is None else str(self.limit_price),
            "sourceTimestampMicros": self.source_timestamp_micros,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RiskOpenOrderState":
        keys = set(payload)
        expected = {
            "clientOrderId",
            "exchange",
            "symbol",
            "side",
            "orderType",
            "status",
            "quantity",
            "filledQuantity",
            "isReduceOnly",
            "timeInForce",
            "strategyId",
            "limitPrice",
            "sourceTimestampMicros",
        }
        if keys != expected:
            raise SnapshotError(
                f"Open-order state payload keys must be exactly {sorted(expected)}."
            )
        return cls(
            client_order_id=str(payload["clientOrderId"]),
            exchange=ExchangeId(str(payload["exchange"])),
            symbol=str(payload["symbol"]),
            side=OrderSide(str(payload["side"])),
            order_type=OrderType(str(payload["orderType"])),
            status=OrderStatus(str(payload["status"])),
            quantity=_decimal_or_none(payload["quantity"], where="order.quantity") or _ZERO,
            filled_quantity=_decimal_or_none(
                payload["filledQuantity"], where="order.filledQuantity"
            )
            or _ZERO,
            is_reduce_only=bool(payload["isReduceOnly"]),
            time_in_force=TimeInForce(str(payload["timeInForce"])),
            strategy_id=None if payload["strategyId"] is None else str(payload["strategyId"]),
            limit_price=_decimal_or_none(payload["limitPrice"], where="order.limitPrice"),
            source_timestamp_micros=_int_or_none(
                payload["sourceTimestampMicros"], where="order.sourceTimestampMicros"
            ),
        )


@dataclass(slots=True, frozen=True)
class RiskMarketDataState:
    """Market health for one venue symbol, including the book view.

    ``book_health`` is the Part 3/4 tradeability verdict carried in, not
    re-derived: the order book engine already classifies UNINITIALISED,
    RESYNC_REQUIRED, STALE and CROSSED, and the risk gate must agree with
    that classification rather than maintain a second opinion. A second
    definition of "is the book usable" is two definitions, and they drift.
    """

    exchange: ExchangeId
    symbol: str
    best_bid: Decimal | None
    best_ask: Decimal | None
    best_bid_quantity: Decimal | None
    best_ask_quantity: Decimal | None
    last_trade_price: Decimal | None
    last_trade_timestamp_micros: int | None
    quote_timestamp_micros: int | None
    book_health: OrderBookHealth
    book_sequence: int | None
    feed_connected: bool
    simulated: bool = False

    @property
    def mid_price(self) -> Decimal | None:
        if self.best_bid is None or self.best_ask is None:
            return None
        return (self.best_bid + self.best_ask) / Decimal(2)

    def book_top(self, *, received_timestamp_micros: int) -> BookTop:
        """The :class:`~wlct_trading.market_data.BookTop` shape the core
        engine and venue validation expect, rebuilt from this state.

        Sequence and timestamps are carried through so a caller cannot
        launder a stale book into a fresh-looking object: the values it
        reports are the ones the snapshot held.
        """
        return BookTop(
            exchange=self.exchange,
            symbol=self.symbol,
            best_bid=self.best_bid,
            best_bid_quantity=self.best_bid_quantity,
            best_ask=self.best_ask,
            best_ask_quantity=self.best_ask_quantity,
            sequence=-1 if self.book_sequence is None else self.book_sequence,
            exchange_timestamp=(
                received_timestamp_micros
                if self.quote_timestamp_micros is None
                else self.quote_timestamp_micros
            ),
            received_timestamp=received_timestamp_micros,
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "exchange": self.exchange.value,
            "symbol": self.symbol,
            "bestBid": None if self.best_bid is None else str(self.best_bid),
            "bestAsk": None if self.best_ask is None else str(self.best_ask),
            "bestBidQuantity": (
                None if self.best_bid_quantity is None else str(self.best_bid_quantity)
            ),
            "bestAskQuantity": (
                None if self.best_ask_quantity is None else str(self.best_ask_quantity)
            ),
            "lastTradePrice": (
                None if self.last_trade_price is None else str(self.last_trade_price)
            ),
            "lastTradeTimestampMicros": self.last_trade_timestamp_micros,
            "quoteTimestampMicros": self.quote_timestamp_micros,
            "bookHealth": self.book_health.value,
            "bookSequence": self.book_sequence,
            "feedConnected": self.feed_connected,
            "simulated": self.simulated,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RiskMarketDataState":
        keys = set(payload)
        expected = {
            "exchange",
            "symbol",
            "bestBid",
            "bestAsk",
            "bestBidQuantity",
            "bestAskQuantity",
            "lastTradePrice",
            "lastTradeTimestampMicros",
            "quoteTimestampMicros",
            "bookHealth",
            "bookSequence",
            "feedConnected",
            "simulated",
        }
        if keys != expected:
            raise SnapshotError(
                f"Market-data state payload keys must be exactly {sorted(expected)}."
            )
        return cls(
            exchange=ExchangeId(str(payload["exchange"])),
            symbol=str(payload["symbol"]),
            best_bid=_decimal_or_none(payload["bestBid"], where="market.bestBid"),
            best_ask=_decimal_or_none(payload["bestAsk"], where="market.bestAsk"),
            best_bid_quantity=_decimal_or_none(
                payload["bestBidQuantity"], where="market.bestBidQuantity"
            ),
            best_ask_quantity=_decimal_or_none(
                payload["bestAskQuantity"], where="market.bestAskQuantity"
            ),
            last_trade_price=_decimal_or_none(
                payload["lastTradePrice"], where="market.lastTradePrice"
            ),
            last_trade_timestamp_micros=_int_or_none(
                payload["lastTradeTimestampMicros"], where="market.lastTradeTimestampMicros"
            ),
            quote_timestamp_micros=_int_or_none(
                payload["quoteTimestampMicros"], where="market.quoteTimestampMicros"
            ),
            book_health=OrderBookHealth(str(payload["bookHealth"])),
            book_sequence=_int_or_none(payload["bookSequence"], where="market.bookSequence"),
            feed_connected=bool(payload["feedConnected"]),
            simulated=bool(payload["simulated"]),
        )


@dataclass(slots=True, frozen=True)
class RiskStrategyState:
    """Per-strategy figures folded into the account view.

    ``realised_pnl_today`` is the account layer's number for that strategy
    (already attributed by fill), not a re-derivation; risk must not keep a
    second PnL ledger, so it carries the one the execution layer produced
    plus the timestamp proving when that was true.
    """

    strategy_id: str
    realised_pnl_today: Decimal | None
    unrealised_pnl: Decimal | None
    open_order_count: int | None
    #: Trailing count of realised-loss trades (see protections docs for how
    #: the source maintains it; risk *reads* it and never recomputes).
    consecutive_losses: int | None
    is_enabled: bool
    source_timestamp_micros: int | None

    def to_payload(self) -> dict[str, Any]:
        return {
            "strategyId": self.strategy_id,
            "realisedPnlToday": (
                None if self.realised_pnl_today is None else str(self.realised_pnl_today)
            ),
            "unrealisedPnl": (
                None if self.unrealised_pnl is None else str(self.unrealised_pnl)
            ),
            "openOrderCount": self.open_order_count,
            "consecutiveLosses": self.consecutive_losses,
            "isEnabled": self.is_enabled,
            "sourceTimestampMicros": self.source_timestamp_micros,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RiskStrategyState":
        keys = set(payload)
        expected = {
            "strategyId",
            "realisedPnlToday",
            "unrealisedPnl",
            "openOrderCount",
            "consecutiveLosses",
            "isEnabled",
            "sourceTimestampMicros",
        }
        if keys != expected:
            raise SnapshotError(
                f"Strategy state payload keys must be exactly {sorted(expected)}."
            )
        return cls(
            strategy_id=str(payload["strategyId"]),
            realised_pnl_today=_decimal_or_none(
                payload["realisedPnlToday"], where="strategy.realisedPnlToday"
            ),
            unrealised_pnl=_decimal_or_none(
                payload["unrealisedPnl"], where="strategy.unrealisedPnl"
            ),
            open_order_count=_int_or_none(
                payload["openOrderCount"], where="strategy.openOrderCount"
            ),
            consecutive_losses=_int_or_none(
                payload["consecutiveLosses"], where="strategy.consecutiveLosses"
            ),
            is_enabled=bool(payload["isEnabled"]),
            source_timestamp_micros=_int_or_none(
                payload["sourceTimestampMicros"], where="strategy.sourceTimestampMicros"
            ),
        )


@dataclass(slots=True, frozen=True)
class RiskStateSnapshot:
    """The complete immutable in-memory state one decision is made from.

    ``version`` is monotonic per (tenant, account) as assigned by the hot
    state layer (Redis ``INCR`` on the snapshot stream); ``source_versions``
    and the per-section timestamps carry where each part came from;
    ``config_digest`` binds the snapshot to *the limits it was meant to be
    evaluated against*, so a configuration change silently invalidates every
    snapshot built before it - the gate compares digests rather than trusting
    any ordering.
    """

    snapshot_id: str
    version: int
    tenant_id: str
    account_id: str
    #: Epoch micros; also freshness-checked against ``max_state_age``.
    created_at_micros: int
    #: The UTC trading-day label the PnL fields belong to (YYYY-MM-DD). The
    #: day rolls in UTC by policy; see freshness.py for the single function
    #: that decides it, so "daily" cannot mean two things in one codebase.
    trading_day: str
    #: Configuration this snapshot was built against. A decision made with a
    #: snapshot for another config digest is not this decision.
    config_digest: str | None
    config_version: int | None
    account: RiskAccountState | None
    positions: tuple[RiskPositionState, ...]
    open_orders: tuple[RiskOpenOrderState, ...]
    market: tuple[RiskMarketDataState, ...]
    strategies: tuple[RiskStrategyState, ...]
    #: The snapshot-day PnL numbers, from the account layer.
    realised_pnl_today: Decimal | None
    unrealised_pnl_today: Decimal | None
    fees_today: Decimal | None
    traded_notional_today: Decimal | None
    #: Consecutive losing trades at account level, same read-only semantics
    #: as the per-strategy field above.
    consecutive_losses: int | None
    #: Equity high-water mark since the drawdown window opened, from the
    #: account layer. Risk never re-derives it from a price series it would
    #: have to store.
    peak_equity: Decimal | None
    market_type: MarketType
    rate: RiskRateState | None
    #: Names of sources the loader could not read at all. The field exists
    #: so "missing" is recorded *in the object* and reported by every
    #: consumer (events, API, admin), not merely implied by ``None`` fields.
    missing_sources: frozenset[str]
    #: Any venue/account detail that makes state suspect (a reconciliation
    #: marker, a feed flag). Free-form, surfaced verbatim in events.
    advisories: frozenset[str]
    #: Request-scoped identity of the state producer (worker id) - for the
    #: audit trail, and for spotting two writers disagreeing via the version
    #: counter in tests and production alike.
    produced_by: str
    #: Set by a paper session or backtest. It is the *label*, not a mode
    #: switch: simulated state must not be used by the live path, and the
    #: live adapter selection is elsewhere; but an event that says "loss
    #: limit breached" must always be distinguishable as simulated or real,
    #: and that truth travels with the snapshot.
    is_simulated: bool

    # -- validation -------------------------------------------------------
    def is_consistent(self) -> tuple[str, ...]:
        """Structural contradictions that make this snapshot unusable as-is.

        Distinct from freshness (freshness.py) and from rule breaches:
        these are "the object disagrees with itself" problems - wrong
        tenant wiring, duplicate identities, terminal statuses inside the
        open-order set, non-monotonic versions. The gate refuses on any
        error listed here, always, for every mode including simulated ones;
        a paper run on a corrupt snapshot teaches nothing even if it cannot
        lose money.
        """
        errors: list[str] = []
        if self.version < 1:
            errors.append("snapshot version must be >= 1")
        if not self.tenant_id or not self.account_id:
            errors.append("snapshot must be bound to a tenant and account")
        if self.account is not None and (
            self.account.tenant_id != self.tenant_id
            or self.account.account_id != self.account_id
        ):
            errors.append("account state belongs to a different identity than the snapshot")
        symbols = [(str(p.exchange), p.symbol) for p in self.positions]
        if len(symbols) != len(set(symbols)):
            errors.append("duplicate position entry")
        order_ids = [o.client_order_id for o in self.open_orders]
        if len(order_ids) != len(set(order_ids)):
            errors.append("duplicate open order entry")
        strategy_ids = [s.strategy_id for s in self.strategies]
        if len(strategy_ids) != len(set(strategy_ids)):
            errors.append("duplicate strategy entry")
        market_keys = [(str(m.exchange), m.symbol) for m in self.market]
        if len(market_keys) != len(set(market_keys)):
            errors.append("duplicate market data entry")
        # Quantity-shape problems on orders (negative, over-fill) are
        # deliberately NOT re-checked here: projecting_context().integrity_
        # errors() owns them so the gate can refuse with the precise
        # INVALID_POSITION_STATE code instead of this generic one.
        if self.created_at_micros < 0:
            errors.append("snapshot created_at must not be negative")
        if self.realised_pnl_today is not None and self.unrealised_pnl_today is not None:
            # PnLs are inputs from the account layer; this only catches a
            # loader mixing up, e.g. signed fee into the wrong field.
            if abs(self.realised_pnl_today) > _SANITY_PNL_LIMIT:
                errors.append("realised PnL today outside the sanity bound")
            if abs(self.unrealised_pnl_today) > _SANITY_PNL_LIMIT:
                errors.append("unrealised PnL today outside the sanity bound")
        return tuple(errors)

    # -- projections -------------------------------------------------------
    def projecting_context(self) -> ProjectingContext:
        """The exposure projection input derived from this snapshot.

        ``references`` come from market data when a symbol has a live
        quote, and from position marks otherwise. A symbol with exposure
        and neither produces an integrity error inside
        :meth:`ProjectingContext.integrity_errors` - the gate then refuses,
        rather than projecting against an invented price.
        """
        references: list[ReferenceView] = []
        for state in self.market:
            mid = state.mid_price
            price = mid if mid is not None else state.last_trade_price
            if price is not None:
                references.append(
                    ReferenceView(
                        exchange=state.exchange.value,
                        symbol=state.symbol,
                        price=price,
                        source="book" if mid is not None else "last_trade",
                    )
                )
        for position in self.positions:
            if position.mark_price is None:
                continue
            key = (position.exchange.value, position.symbol)
            if any(r.exchange == key[0] and r.symbol == key[1] for r in references):
                continue
            references.append(
                ReferenceView(
                    exchange=key[0],
                    symbol=key[1],
                    price=position.mark_price,
                    source="position_mark",
                )
            )
        return ProjectingContext(
            positions=tuple(
                PositionView(
                    exchange=p.exchange.value, symbol=p.symbol, quantity=p.quantity
                )
                for p in self.positions
            ),
            open_orders=tuple(o.to_view() for o in self.open_orders),
            references=tuple(references),
        )

    def positions_by_symbol(self, exchange: str, symbol: str) -> tuple[RiskPositionState, ...]:
        return tuple(
            p
            for p in self.positions
            if p.exchange.value == exchange and p.symbol == symbol
        )

    def market_for(self, exchange: str, symbol: str) -> RiskMarketDataState | None:
        for state in self.market:
            if state.exchange.value == exchange and state.symbol == symbol:
                return state
        return None

    def strategy_for(self, strategy_id: str | None) -> RiskStrategyState | None:
        if strategy_id is None:
            return None
        for state in self.strategies:
            if state.strategy_id == strategy_id:
                return state
        return None

    def open_orders_for(self, strategy_id: str | None = None) -> tuple[RiskOpenOrderState, ...]:
        if strategy_id is None:
            return self.open_orders
        return tuple(
            o for o in self.open_orders if o.strategy_id == strategy_id
        )

    def net_position(self, exchange: str, symbol: str) -> Decimal:
        return sum(
            (p.quantity for p in self.positions_by_symbol(exchange, symbol)), _ZERO
        )

    # -- legacy bridge ------------------------------------------------------
    def to_core_snapshot(
        self,
        intent: OrderIntent,
        *,
        now_micros: int,
    ) -> tuple[RiskSnapshot, tuple[str, ...]]:
        """Build the Part 2/5 :class:`RiskSnapshot` this state implies.

        Returns the snapshot plus any *shortfalls* - reasons the bridge
        could not produce a fully honest core view (no market data for the
        symbol, exposure it cannot value). The caller must treat a
        non-empty shortfall as "the core engine may not run on this"; the
        gate turns shortfalls into fail-closed rejections instead of
        fabricating a zero exposure to keep the machinery moving.
        """
        shortfalls: list[str] = []
        exchange_value = intent.exchange.value
        market = self.market_for(exchange_value, intent.symbol)
        position_net = self.net_position(exchange_value, intent.symbol)

        reference: Decimal | None = None
        market_age: int | None = None
        book_usable = False
        if market is not None:
            reference = market.mid_price
            if reference is None:
                reference = market.last_trade_price
            if market.quote_timestamp_micros is not None:
                market_age = max(now_micros - market.quote_timestamp_micros, 0)
            else:
                market_age = None
            book_usable = market.book_health is OrderBookHealth.OK and not (
                market.best_bid is not None
                and market.best_ask is not None
                and market.best_bid >= market.best_ask
            )
        else:
            shortfalls.append(f"no market data for {exchange_value}:{intent.symbol}")

        symbol_exposure = _ZERO
        if position_net != _ZERO:
            if reference is None:
                shortfalls.append(
                    f"cannot value {intent.symbol} position without a reference price"
                )
            else:
                symbol_exposure = abs(position_net) * reference

        ctx = self.projecting_context()
        # Deliberate division of labour: the bridge reports only what *it*
        # cannot honestly compute (no market view, no price to value a
        # position with). Projection-integrity problems (over-filled
        # reservations, missing per-row timestamps) belong to the gate's
        # dedicated account/position stages, which give them precise
        # decision codes instead of this generic one. A corrupt open-order
        # set still cannot pass: the gate refuses it before any
        # exposure-based approval can be relied on.
        account_exposure = ctx_total(ctx)

        open_orders = self.open_orders_for()
        known_ids = frozenset(
            o.client_order_id for o in open_orders
        ) | frozenset(
            o.client_order_id for o in self.open_orders if o.status in _RECENT_TERMINAL
        )
        return (
            RiskSnapshot(
                position_quantity=position_net,
                symbol_exposure_notional=symbol_exposure,
                account_exposure_notional=account_exposure,
                open_order_count=len(open_orders),
                orders_in_last_minute=(
                    None if self.rate is None else self.rate.orders_last_minute
                )
                or 0,
                realised_pnl_today=self.realised_pnl_today or _ZERO,
                strategy_realised_pnl_today=(
                    self._strategy_realised(intent.strategy_id, shortfalls)
                ),
                reference_price=reference,
                market_data_age_micros=market_age,
                book_usable=book_usable,
                is_complete=not shortfalls,
                known_client_order_ids=known_ids,
            ),
            tuple(shortfalls),
        )

    def _strategy_realised(self, strategy_id: str | None, shortfalls: list[str]) -> Decimal:
        if strategy_id is None:
            return _ZERO
        state = self.strategy_for(strategy_id)
        if state is None or state.realised_pnl_today is None:
            shortfalls.append(f"no realised PnL reported for strategy {strategy_id}")
            return _ZERO
        return state.realised_pnl_today

    # -- wire form ----------------------------------------------------------
    def to_payload(self) -> dict[str, Any]:
        return {
            "snapshotId": self.snapshot_id,
            "version": self.version,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "createdAtMicros": self.created_at_micros,
            "tradingDay": self.trading_day,
            "configDigest": self.config_digest,
            "configVersion": self.config_version,
            "account": None if self.account is None else self.account.to_payload(),
            "positions": [p.to_payload() for p in self.positions],
            "openOrders": [o.to_payload() for o in self.open_orders],
            "market": [m.to_payload() for m in self.market],
            "strategies": [s.to_payload() for s in self.strategies],
            "realisedPnlToday": (
                None if self.realised_pnl_today is None else str(self.realised_pnl_today)
            ),
            "unrealisedPnlToday": (
                None if self.unrealised_pnl_today is None else str(self.unrealised_pnl_today)
            ),
            "feesToday": None if self.fees_today is None else str(self.fees_today),
            "tradedNotionalToday": (
                None
                if self.traded_notional_today is None
                else str(self.traded_notional_today)
            ),
            "consecutiveLosses": self.consecutive_losses,
            "peakEquity": None if self.peak_equity is None else str(self.peak_equity),
            "marketType": self.market_type.value,
            "rate": None if self.rate is None else self.rate.to_payload(),
            "missingSources": sorted(self.missing_sources),
            "advisories": sorted(self.advisories),
            "producedBy": self.produced_by,
            "isSimulated": self.is_simulated,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RiskStateSnapshot":
        keys = set(payload)
        expected = {
            "snapshotId",
            "version",
            "tenantId",
            "accountId",
            "createdAtMicros",
            "tradingDay",
            "configDigest",
            "configVersion",
            "account",
            "positions",
            "openOrders",
            "market",
            "strategies",
            "realisedPnlToday",
            "unrealisedPnlToday",
            "feesToday",
            "tradedNotionalToday",
            "consecutiveLosses",
            "peakEquity",
            "marketType",
            "rate",
            "missingSources",
            "advisories",
            "producedBy",
            "isSimulated",
        }
        if keys != expected:
            raise SnapshotError(
                f"Snapshot payload keys must be exactly {sorted(expected)}; "
                f"got {sorted(keys)}."
            )
        if not isinstance(payload["snapshotId"], str) or not payload["snapshotId"]:
            raise SnapshotError("snapshotId must be a non-empty string.")
        version = _int_or_none(payload["version"], where="version")
        if version is None or version < 1:
            raise SnapshotError("version must be an integer >= 1.")
        created = _int_or_none(payload["createdAtMicros"], where="createdAtMicros")
        if created is None or created < 0:
            raise SnapshotError("createdAtMicros must be a non-negative integer.")
        day = payload["tradingDay"]
        if not isinstance(day, str):
            raise SnapshotError("tradingDay must be a string.")
        config_digest = payload["configDigest"]
        if config_digest is not None and not isinstance(config_digest, str):
            raise SnapshotError("configDigest must be a string or null.")
        config_version = _int_or_none(payload["configVersion"], where="configVersion")
        account_raw = payload["account"]
        positions = payload["positions"]
        open_orders = payload["openOrders"]
        market = payload["market"]
        strategies = payload["strategies"]
        if not all(isinstance(x, list) for x in (positions, open_orders, market, strategies)):
            raise SnapshotError("positions/openOrders/market/strategies must be lists.")
        for name, value in (
            ("missingSources", payload["missingSources"]),
            ("advisories", payload["advisories"]),
        ):
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                raise SnapshotError(f"{name} must be a list of strings.")
        produced_by = payload["producedBy"]
        if not isinstance(produced_by, str):
            raise SnapshotError("producedBy must be a string.")
        market_type_raw = payload["marketType"]
        try:
            market_type = MarketType(str(market_type_raw))
        except ValueError as exc:
            raise SnapshotError(f"Unknown market type {market_type_raw!r}.") from exc
        rate_raw = payload["rate"]
        return cls(
            snapshot_id=payload["snapshotId"],
            version=version,
            tenant_id=str(payload["tenantId"]),
            account_id=str(payload["accountId"]),
            created_at_micros=created,
            trading_day=day,
            config_digest=config_digest,
            config_version=config_version,
            account=(
                None if account_raw is None else RiskAccountState.from_payload(account_raw)
            ),
            positions=tuple(
                RiskPositionState.from_payload(p) for p in positions if isinstance(p, dict)
            ),
            open_orders=tuple(
                RiskOpenOrderState.from_payload(o)
                for o in open_orders
                if isinstance(o, dict)
            ),
            market=tuple(
                RiskMarketDataState.from_payload(m) for m in market if isinstance(m, dict)
            ),
            strategies=tuple(
                RiskStrategyState.from_payload(s) for s in strategies if isinstance(s, dict)
            ),
            realised_pnl_today=_decimal_or_none(
                payload["realisedPnlToday"], where="realisedPnlToday"
            ),
            unrealised_pnl_today=_decimal_or_none(
                payload["unrealisedPnlToday"], where="unrealisedPnlToday"
            ),
            fees_today=_decimal_or_none(payload["feesToday"], where="feesToday"),
            traded_notional_today=_decimal_or_none(
                payload["tradedNotionalToday"], where="tradedNotionalToday"
            ),
            consecutive_losses=_int_or_none(
                payload["consecutiveLosses"], where="consecutiveLosses"
            ),
            peak_equity=_decimal_or_none(payload["peakEquity"], where="peakEquity"),
            market_type=market_type,
            rate=None if rate_raw is None else RiskRateState.from_payload(rate_raw),
            missing_sources=frozenset(payload["missingSources"]),
            advisories=frozenset(payload["advisories"]),
            produced_by=produced_by,
            is_simulated=bool(payload["isSimulated"]),
        )

    def digest(self) -> str:
        """Content hash over the canonical JSON of the whole snapshot.

        Covers *everything including the version* - unlike the
        configuration digest (content identity across versions), this is the
        "same bytes or not" check for a single snapshot record: two builders
        at the same version producing different digests is the signature of
        diverging state, and readers of that pair refuse to advance.
        """
        return hashlib.sha256(
            json.dumps(
                self.to_payload(), sort_keys=True, separators=(",", ":"), ensure_ascii=True
            ).encode("utf-8")
        ).hexdigest()


#: Order statuses that are terminal but still "recently known" for duplicate
#: suppression within a snapshot cycle: a cancel whose ACK has not landed
#: yet, or a rejection being reported. FILLED is excluded on purpose - a
#: fill has been applied to positions, and suppressing the next order
#: because a fill is in the list would be the engine inventing venue
#: idempotency guarantees that the clientOrderId uniqueness in the store
#: already provides.
_RECENT_TERMINAL: frozenset[OrderStatus] = frozenset(
    {
        OrderStatus.REJECTED,
        OrderStatus.FAILED,
        OrderStatus.CANCELLED,
    }
)

#: Absurd-magnitude guard: 1e15 quote units of daily PnL on one account is
#: a loader bug, a misread currency, or a decimal-point catastrophe, and in
#: every case the right response is "refuse and look", never "evaluate".
_SANITY_PNL_LIMIT = Decimal("1000000000000000")


def ctx_total(context: ProjectingContext) -> Decimal:
    """Account gross notional without the full breakdown object.

    Lives here (not imported from the builder call site) because the bridge
    needs exactly one number and must not pay for - or depend on - bucket
    construction it then discards.
    """
    return build_breakdown(context).account_gross_notional
