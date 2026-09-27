"""Binance private user-data stream.

The authenticated counterpart to the Part 3/4 public feed. It is how the
platform learns about fills it did not cause, cancellations made from the
Binance app, and balance changes from transfers — none of which any amount of
REST polling would catch promptly.

Three things make this stream different from a public one and shape the whole
module:

**The listen key is a bearer credential.** Anyone holding it can read the
account's order flow. It appears in the WebSocket URL, which is exactly the sort
of string that ends up in a connection log. So it is masked in every string this
module produces, never logged, and never returned by any accessor.

**It expires.** A listen key is valid for 60 minutes and must be renewed by a
keepalive. The refresh interval defaults to 30 minutes — half the window — so a
single failed renewal is survivable. A missed renewal drops the stream, and a
dropped stream means fills nobody sees.

**Reconnection is a correctness event, not just an availability one.** Events
that occurred while disconnected are gone: Binance does not replay. Every
reconnect therefore triggers reconciliation, and the caller is told so
explicitly through :attr:`UserDataStream.reconnect_count` and the
``on_resynchronise`` callback.

Backend-only. Nothing in this module may be reachable from a mobile client or
the admin web app: the payloads carry the full order flow of a real account.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Any, Awaitable, Callable, Mapping, Sequence

from wlct_trading.adapters.base import AccountBalance, AdapterError
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderSide, OrderStatus
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_SPOT_WS_BASE,
    BINANCE_TESTNET_WS_BASE,
)
from wlct_trading.exchanges.binance.parsers import BinanceParseError, parse_decimal
from wlct_trading.exchanges.binance.trading import from_binance_status
from wlct_trading.execution.credentials import REDACTED
from wlct_trading.orders import Fill

__all__ = [
    "UserStreamEventType",
    "ExecutionReport",
    "BalanceSnapshot",
    "BalanceDelta",
    "ListenKeyExpired",
    "UserStreamEvent",
    "ListenKeyManager",
    "parse_user_stream_message",
    "mask_listen_key",
]


def mask_listen_key(listen_key: str) -> str:
    """Render a listen key safely for a diagnostic message.

    Shows enough to correlate two log lines and not enough to use. The full key
    never appears in any string this module produces.
    """
    if not listen_key:
        return REDACTED
    if len(listen_key) <= 8:
        return REDACTED
    return f"{listen_key[:4]}...{listen_key[-4:]}"


class UserStreamEventType(str, Enum):
    """The event kinds Binance sends on a spot user-data stream."""

    EXECUTION_REPORT = "executionReport"
    OUTBOUND_ACCOUNT_POSITION = "outboundAccountPosition"
    BALANCE_UPDATE = "balanceUpdate"
    LISTEN_KEY_EXPIRED = "listenKeyExpired"
    #: A message the platform does not model. Surfaced rather than dropped so a
    #: new venue event type is visible instead of silently ignored.
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class ExecutionReport:
    """A normalised ``executionReport``.

    This is the venue telling us what happened to an order. It is the single
    most important message in the platform: it is where a real fill comes from.
    """

    client_order_id: str
    #: Present on a cancellation: the id of the order being cancelled. The
    #: ``clientOrderId`` field then holds the *cancel request's* id, which is a
    #: genuinely surprising piece of the protocol and a common source of bugs.
    original_client_order_id: str | None
    exchange_order_id: str
    venue_symbol: str
    side: OrderSide
    status: OrderStatus
    execution_type: str
    order_quantity: Decimal
    cumulative_filled_quantity: Decimal
    last_filled_quantity: Decimal
    last_filled_price: Decimal
    cumulative_quote_quantity: Decimal
    commission: Decimal
    commission_asset: str | None
    trade_id: str | None
    is_maker: bool
    event_time_micros: int
    transaction_time_micros: int
    rejection_reason: str | None

    @property
    def is_trade(self) -> bool:
        """Whether this report represents an actual execution.

        Only ``TRADE`` reports move money. ``NEW``, ``CANCELED`` and
        ``EXPIRED`` are lifecycle transitions with zero filled quantity, and
        treating one as a fill would book a phantom trade at price zero.
        """
        return self.execution_type == "TRADE" and self.last_filled_quantity > 0

    @property
    def effective_client_order_id(self) -> str:
        """The id of the order this report is *about*.

        On a cancellation Binance puts the cancelled order's id in
        ``origClientOrderId`` and a fresh id in ``clientOrderId``. Matching on
        the wrong one leaves the real order stuck in CANCEL_REQUESTED forever.
        """
        if self.execution_type == "CANCELED" and self.original_client_order_id:
            return self.original_client_order_id
        return self.client_order_id

    def to_fill(self, *, order_id: str, symbol: str) -> Fill:
        """Build a normalised :class:`Fill`.

        Only valid when :attr:`is_trade`; callers must check first. The
        ``fill_id`` is deterministic — ``{exchangeOrderId}:{tradeId}`` — so the
        same execution arriving again by REST reconciliation deduplicates
        against this one instead of double-counting the position.
        """
        if not self.is_trade:
            raise ValueError(
                "Refusing to build a Fill from a non-trade execution report; "
                "that would fabricate an execution the venue never made."
            )
        return Fill(
            fill_id=f"{self.exchange_order_id}:{self.trade_id}",
            order_id=order_id,
            trade_id=str(self.trade_id),
            price=self.last_filled_price,
            quantity=self.last_filled_quantity,
            fee=self.commission,
            fee_currency=self.commission_asset or "",
            is_maker=self.is_maker,
            is_simulated=False,
            exchange_timestamp=self.transaction_time_micros,
            received_timestamp=epoch_micros(),
            symbol=symbol,
            side=self.side,
            exchange=ExchangeId.BINANCE,
            quote_quantity=self.last_filled_price * self.last_filled_quantity,
            exchange_order_id=self.exchange_order_id,
        )


@dataclass(frozen=True, slots=True)
class BalanceSnapshot:
    """A normalised ``outboundAccountPosition``: balances that just changed."""

    balances: tuple[AccountBalance, ...]
    event_time_micros: int
    last_update_micros: int


@dataclass(frozen=True, slots=True)
class BalanceDelta:
    """A normalised ``balanceUpdate``: a deposit, withdrawal or transfer.

    Reported but never used to adjust a position. A balance moving for a reason
    outside trading is exactly the thing that must not be mistaken for a fill.
    """

    asset: str
    delta: Decimal
    event_time_micros: int
    clear_time_micros: int


@dataclass(frozen=True, slots=True)
class ListenKeyExpired:
    """The venue has invalidated the listen key.

    The connection is dead and a new key must be created. Reconnecting with the
    same key silently yields a socket that never delivers anything, which is
    considerably worse than an error.
    """

    event_time_micros: int


@dataclass(frozen=True, slots=True)
class UserStreamEvent:
    """One parsed message from the private stream."""

    event_type: UserStreamEventType
    received_at_micros: int
    execution: ExecutionReport | None = None
    balances: BalanceSnapshot | None = None
    balance_delta: BalanceDelta | None = None
    expiry: ListenKeyExpired | None = None
    #: The raw event name, retained for an UNKNOWN event so an operator can see
    #: what the venue actually sent.
    raw_event_name: str = ""


def _require(payload: Mapping[str, Any], key: str, context: str) -> Any:
    if key not in payload:
        raise BinanceParseError(
            f"Binance {context} message is missing the required field {key!r}."
        )
    return payload[key]


def _millis_to_micros(value: Any, field_name: str) -> int:
    try:
        return int(value) * 1_000
    except (TypeError, ValueError) as exc:
        raise BinanceParseError(
            f"Expected a millisecond timestamp for {field_name}; got {value!r}."
        ) from exc


def parse_user_stream_message(raw: str | Mapping[str, Any]) -> UserStreamEvent:
    """Parse one private-stream message.

    Pure and synchronous, so the entire event vocabulary is testable from a
    string literal with no socket, no key and no venue.

    Numbers are decoded with ``parse_float=str`` and converted through
    :func:`parse_decimal`, so a quantity never passes through a binary float.
    """
    received = epoch_micros()

    if isinstance(raw, str):
        try:
            payload = json.loads(raw, parse_float=str, parse_int=str)
        except (ValueError, TypeError) as exc:
            raise BinanceParseError(
                "Private stream message is not valid JSON."
            ) from exc
    else:
        payload = raw

    if not isinstance(payload, Mapping):
        raise BinanceParseError(
            "Private stream message is not a JSON object."
        )

    # A combined-stream wrapper puts the real event under "data".
    if "data" in payload and isinstance(payload["data"], Mapping):
        payload = payload["data"]

    event_name = str(payload.get("e", ""))

    if event_name == UserStreamEventType.EXECUTION_REPORT.value:
        return UserStreamEvent(
            event_type=UserStreamEventType.EXECUTION_REPORT,
            received_at_micros=received,
            execution=_parse_execution_report(payload),
            raw_event_name=event_name,
        )

    if event_name == UserStreamEventType.OUTBOUND_ACCOUNT_POSITION.value:
        return UserStreamEvent(
            event_type=UserStreamEventType.OUTBOUND_ACCOUNT_POSITION,
            received_at_micros=received,
            balances=_parse_account_position(payload),
            raw_event_name=event_name,
        )

    if event_name == UserStreamEventType.BALANCE_UPDATE.value:
        return UserStreamEvent(
            event_type=UserStreamEventType.BALANCE_UPDATE,
            received_at_micros=received,
            balance_delta=BalanceDelta(
                asset=str(_require(payload, "a", "balanceUpdate")),
                delta=parse_decimal(_require(payload, "d", "balanceUpdate"), "d"),
                event_time_micros=_millis_to_micros(payload.get("E", 0), "E"),
                clear_time_micros=_millis_to_micros(payload.get("T", 0), "T"),
            ),
            raw_event_name=event_name,
        )

    if event_name == UserStreamEventType.LISTEN_KEY_EXPIRED.value:
        return UserStreamEvent(
            event_type=UserStreamEventType.LISTEN_KEY_EXPIRED,
            received_at_micros=received,
            expiry=ListenKeyExpired(
                event_time_micros=_millis_to_micros(payload.get("E", 0), "E")
            ),
            raw_event_name=event_name,
        )

    return UserStreamEvent(
        event_type=UserStreamEventType.UNKNOWN,
        received_at_micros=received,
        raw_event_name=event_name,
    )


def _parse_execution_report(payload: Mapping[str, Any]) -> ExecutionReport:
    """Normalise Binance's single-letter execution report fields."""
    raw_side = str(_require(payload, "S", "executionReport")).upper()
    original = payload.get("C")
    # Binance sends "" rather than null when there is no original id, and an
    # empty string here would be matched against a real clientOrderId.
    original_client_order_id = str(original) if original else None

    trade_id_raw = payload.get("t")
    trade_id = str(trade_id_raw) if trade_id_raw not in (None, "-1", -1) else None

    commission_asset = payload.get("N")
    reject_reason = str(payload.get("r", "NONE"))

    return ExecutionReport(
        client_order_id=str(_require(payload, "c", "executionReport")),
        original_client_order_id=original_client_order_id,
        exchange_order_id=str(_require(payload, "i", "executionReport")),
        venue_symbol=str(_require(payload, "s", "executionReport")),
        side=OrderSide.BUY if raw_side == "BUY" else OrderSide.SELL,
        status=from_binance_status(str(_require(payload, "X", "executionReport"))),
        execution_type=str(_require(payload, "x", "executionReport")).upper(),
        order_quantity=parse_decimal(payload.get("q", "0"), "q"),
        cumulative_filled_quantity=parse_decimal(payload.get("z", "0"), "z"),
        last_filled_quantity=parse_decimal(payload.get("l", "0"), "l"),
        last_filled_price=parse_decimal(payload.get("L", "0"), "L"),
        cumulative_quote_quantity=parse_decimal(payload.get("Z", "0"), "Z"),
        commission=parse_decimal(payload.get("n", "0"), "n"),
        commission_asset=str(commission_asset) if commission_asset else None,
        trade_id=trade_id,
        is_maker=bool(payload.get("m", False)),
        event_time_micros=_millis_to_micros(payload.get("E", 0), "E"),
        transaction_time_micros=_millis_to_micros(
            payload.get("T", payload.get("E", 0)), "T"
        ),
        rejection_reason=None if reject_reason == "NONE" else reject_reason,
    )


def _parse_account_position(payload: Mapping[str, Any]) -> BalanceSnapshot:
    raw_balances = payload.get("B") or ()
    balances: list[AccountBalance] = []
    if isinstance(raw_balances, Sequence) and not isinstance(raw_balances, (str, bytes)):
        for entry in raw_balances:
            if not isinstance(entry, Mapping):
                continue
            balances.append(
                AccountBalance(
                    asset=str(entry.get("a", "")),
                    free=parse_decimal(entry.get("f", "0"), "balance.free"),
                    locked=parse_decimal(entry.get("l", "0"), "balance.locked"),
                )
            )
    return BalanceSnapshot(
        balances=tuple(balances),
        event_time_micros=_millis_to_micros(payload.get("E", 0), "E"),
        last_update_micros=_millis_to_micros(payload.get("u", payload.get("E", 0)), "u"),
    )


class ListenKeyManager:
    """Creates, renews and closes a Binance listen key.

    Owns exactly one key at a time for one account. The key itself is never
    exposed by a property or returned by a public method — callers get a URL
    from :meth:`stream_url` and nothing else, so there is no accessor to
    accidentally log.
    """

    __slots__ = (
        "_create",
        "_keepalive",
        "_close",
        "_ws_base",
        "_refresh_interval_micros",
        "_listen_key",
        "_created_at_micros",
        "_last_renewed_micros",
        "_renewal_failures",
        "_renewal_count",
    )

    def __init__(
        self,
        *,
        create: Callable[[], Awaitable[str]],
        keepalive: Callable[[str], Awaitable[None]],
        close: Callable[[str], Awaitable[None]],
        testnet: bool = False,
        ws_base: str | None = None,
        refresh_interval_millis: int = 1_800_000,
    ) -> None:
        """
        ``refresh_interval_millis`` defaults to 30 minutes against a 60-minute
        expiry. Half the window means one renewal can fail entirely — a blip, a
        rate limit, a brief venue outage — and the stream still survives to try
        again.
        """
        base = ws_base or (BINANCE_TESTNET_WS_BASE if testnet else BINANCE_SPOT_WS_BASE)
        cleaned = base.strip().rstrip("/")
        if not cleaned.startswith("wss://"):
            raise ValueError(
                f"The user-data stream must use wss://; got {base!r}. The URL "
                f"contains the listen key, and a plaintext socket would expose "
                f"it to anyone on the path."
            )
        if refresh_interval_millis <= 0 or refresh_interval_millis > 3_300_000:
            raise ValueError(
                "refresh_interval_millis must be positive and below 55 minutes; "
                "a longer interval risks the key expiring before renewal."
            )
        self._create = create
        self._keepalive = keepalive
        self._close = close
        self._ws_base = cleaned
        self._refresh_interval_micros = refresh_interval_millis * 1_000
        self._listen_key: str | None = None
        self._created_at_micros: int | None = None
        self._last_renewed_micros: int | None = None
        self._renewal_failures = 0
        self._renewal_count = 0

    @property
    def has_key(self) -> bool:
        return self._listen_key is not None

    @property
    def masked_key(self) -> str:
        """A safe identifier for diagnostics. Never the full key."""
        return mask_listen_key(self._listen_key or "")

    @property
    def renewal_failures(self) -> int:
        return self._renewal_failures

    @property
    def renewal_count(self) -> int:
        return self._renewal_count

    def needs_renewal(self, *, now_micros: int | None = None) -> bool:
        now = epoch_micros() if now_micros is None else now_micros
        anchor = self._last_renewed_micros or self._created_at_micros
        if anchor is None:
            return False
        return (now - anchor) >= self._refresh_interval_micros

    async def acquire(self) -> str:
        """Create a listen key and return the **stream URL**, not the key.

        Returning the URL rather than the key is deliberate: the key has exactly
        one legitimate use, and handing callers the raw value invites it into a
        log line or an error message.
        """
        key = await self._create()
        if not key or not isinstance(key, str):
            raise AdapterError(
                "Binance returned an empty listen key; the private stream "
                "cannot be established."
            )
        self._listen_key = key
        self._created_at_micros = epoch_micros()
        self._last_renewed_micros = self._created_at_micros
        return self.stream_url()

    def stream_url(self) -> str:
        """The WebSocket URL for the current key."""
        if self._listen_key is None:
            raise AdapterError(
                "No listen key has been acquired; call acquire() first."
            )
        return f"{self._ws_base}/ws/{self._listen_key}"

    async def renew(self) -> bool:
        """Send a keepalive. Returns whether it succeeded.

        Never raises. A failed renewal is expected occasionally and is handled
        by trying again before the window closes; turning it into an exception
        would take down a stream that is still perfectly alive.
        """
        if self._listen_key is None:
            return False
        try:
            await self._keepalive(self._listen_key)
        except Exception:  # noqa: BLE001 - a failure is data, not an error
            self._renewal_failures += 1
            return False
        self._last_renewed_micros = epoch_micros()
        self._renewal_count += 1
        self._renewal_failures = 0
        return True

    async def release(self) -> None:
        """Close the key at the venue and forget it locally.

        The local key is cleared even if the venue call fails: a key we can no
        longer prove is valid must not be reused, and it expires on its own
        within the hour regardless.
        """
        key = self._listen_key
        self._listen_key = None
        self._created_at_micros = None
        self._last_renewed_micros = None
        if key is None:
            return
        try:
            await self._close(key)
        except Exception:  # noqa: BLE001 - best effort
            return

    def invalidate(self) -> None:
        """Discard the key without contacting the venue.

        Used on ``listenKeyExpired``: the venue has already invalidated it, and
        a close call would just be a wasted request returning an error.
        """
        self._listen_key = None
        self._created_at_micros = None
        self._last_renewed_micros = None

    def status(self, *, now_micros: int | None = None) -> dict[str, object]:
        """Log-safe status. Contains the masked key only."""
        now = epoch_micros() if now_micros is None else now_micros
        age = (
            (now - self._created_at_micros) // 1_000
            if self._created_at_micros is not None
            else None
        )
        since_renewal = (
            (now - self._last_renewed_micros) // 1_000
            if self._last_renewed_micros is not None
            else None
        )
        return {
            "hasKey": self.has_key,
            "listenKey": self.masked_key,
            "ageMillis": age,
            "millisSinceRenewal": since_renewal,
            "renewalCount": self._renewal_count,
            "renewalFailures": self._renewal_failures,
            "needsRenewal": self.needs_renewal(now_micros=now),
        }
