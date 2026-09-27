"""Pre-network order validation.

Ten checks that run before a single byte leaves the process. Their purpose is
not to duplicate the venue's validation — the venue is authoritative and will
apply its own — but to catch the errors that are cheap to catch locally and
expensive to catch remotely:

* A malformed order costs a round trip, consumes rate-limit weight, and on a
  fast-moving symbol the rejection arrives after the opportunity has gone.
* Some malformed orders are *not* rejected. A quantity with too many decimal
  places may be silently truncated; a price outside a sane band may fill
  instantly at a terrible level. Local validation is the only thing standing
  between a fat-fingered Decimal and a real loss.

The checks, in order:

===  ==========================================================================
#    Check
===  ==========================================================================
1    Required identity fields are present (tenant, account, exchange, symbol)
2    Symbol is known to the registry and currently tradeable
3    Side and order type form a supported combination
4    Quantity is a positive, finite Decimal
5    Price is present exactly when the order type requires it, and positive
6    Stop price is present exactly when the order type requires it
7    Quantity and price satisfy the venue's step/tick/min/max rules
8    Notional clears the venue minimum and the platform's own ceiling
9    Time-in-force is supported for this order type on this venue
10   Price is within a sanity band of the reference price (fat-finger guard)
===  ==========================================================================

The result is a list of every failure, not just the first. An operator or a
strategy author fixing one problem at a time across ten round trips is a waste
of everyone's afternoon.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum

from wlct_trading.adapters.base import SymbolSpecification
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import OrderSide, OrderType, TimeInForce
from wlct_trading.orders import OrderIntent

__all__ = [
    "ValidationCode",
    "ValidationIssue",
    "ValidationResult",
    "OrderValidator",
    "DEFAULT_PRICE_BAND_PERCENT",
]

#: How far a limit price may sit from the reference price before it is treated
#: as a mistake. 20% is wide enough for a deliberately passive resting order on
#: a volatile pair and narrow enough to catch a decimal-point error.
DEFAULT_PRICE_BAND_PERCENT = Decimal("20")


class ValidationCode(str, Enum):
    """Normalised reason codes.

    Stable strings: they end up in audit records, metrics labels and API error
    payloads, so they are part of the platform's contract.
    """

    MISSING_TENANT = "MISSING_TENANT"
    MISSING_ACCOUNT = "MISSING_ACCOUNT"
    MISSING_SYMBOL = "MISSING_SYMBOL"
    UNKNOWN_SYMBOL = "UNKNOWN_SYMBOL"
    SYMBOL_NOT_TRADEABLE = "SYMBOL_NOT_TRADEABLE"
    UNSUPPORTED_ORDER_TYPE = "UNSUPPORTED_ORDER_TYPE"
    UNSUPPORTED_SIDE = "UNSUPPORTED_SIDE"
    INVALID_QUANTITY = "INVALID_QUANTITY"
    INVALID_PRICE = "INVALID_PRICE"
    PRICE_NOT_ALLOWED = "PRICE_NOT_ALLOWED"
    PRICE_REQUIRED = "PRICE_REQUIRED"
    STOP_PRICE_REQUIRED = "STOP_PRICE_REQUIRED"
    STOP_PRICE_NOT_ALLOWED = "STOP_PRICE_NOT_ALLOWED"
    LOT_SIZE_VIOLATION = "LOT_SIZE_VIOLATION"
    TICK_SIZE_VIOLATION = "TICK_SIZE_VIOLATION"
    MIN_NOTIONAL_VIOLATION = "MIN_NOTIONAL_VIOLATION"
    MAX_NOTIONAL_VIOLATION = "MAX_NOTIONAL_VIOLATION"
    UNSUPPORTED_TIME_IN_FORCE = "UNSUPPORTED_TIME_IN_FORCE"
    PRICE_BAND_VIOLATION = "PRICE_BAND_VIOLATION"
    REDUCE_ONLY_UNSUPPORTED = "REDUCE_ONLY_UNSUPPORTED"
    CLIENT_ORDER_ID_INVALID = "CLIENT_ORDER_ID_INVALID"


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    """One validation failure."""

    code: ValidationCode
    message: str
    field_name: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code.value,
            "message": self.message,
            "field": self.field_name,
        }


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Outcome of validating one order intent."""

    valid: bool
    issues: tuple[ValidationIssue, ...]
    validated_at_micros: int
    #: The specification the order was checked against, when one was found.
    specification: SymbolSpecification | None = None

    @property
    def first_code(self) -> ValidationCode | None:
        return self.issues[0].code if self.issues else None

    @property
    def summary(self) -> str:
        if self.valid:
            return "Order passed all pre-network validation checks."
        return "; ".join(issue.message for issue in self.issues)

    def to_dict(self) -> dict[str, object]:
        return {
            "valid": self.valid,
            "validatedAtMicros": self.validated_at_micros,
            "issues": [issue.to_dict() for issue in self.issues],
            "summary": self.summary,
        }


def _is_usable_decimal(value: object) -> bool:
    """Reject NaN, infinity and anything that is not a Decimal at all.

    The parameter is deliberately ``object``, not ``Decimal``: this runs on
    numbers that crossed a serialisation boundary, and a declared ``Decimal``
    would let flow analysis prove the isinstance guard dead — the guard is the
    point.
    """
    if not isinstance(value, Decimal):
        return False
    try:
        return value.is_finite()
    except (InvalidOperation, TypeError):  # pragma: no cover - defensive
        return False


class OrderValidator:
    """Validates order intents against venue rules and platform policy.

    Stateless apart from its configured limits, so one instance is safe to
    share across every worker and every tenant.
    """

    __slots__ = (
        "_price_band_percent",
        "_max_notional",
        "_supported_time_in_force",
        "_allow_reduce_only",
        "_client_order_id_max_length",
    )

    def __init__(
        self,
        *,
        price_band_percent: Decimal = DEFAULT_PRICE_BAND_PERCENT,
        max_notional: Decimal | None = None,
        supported_time_in_force: frozenset[TimeInForce] | None = None,
        allow_reduce_only: bool = False,
        client_order_id_max_length: int = 36,
    ) -> None:
        """
        ``allow_reduce_only`` defaults to ``False`` because Binance Spot — the
        first authenticated venue — has no reduce-only flag, and quietly
        dropping it would turn a position-closing order into a position-opening
        one. The capability registry decides per venue; the default is the
        conservative answer.

        ``client_order_id_max_length`` is 36 to match Binance's ``newClientOrderId``
        limit. The Part 2 generator produces 33 characters, which fits.
        """
        if price_band_percent <= 0:
            raise ValueError("price_band_percent must be positive.")
        self._price_band_percent = price_band_percent
        self._max_notional = max_notional
        self._supported_time_in_force = supported_time_in_force or frozenset(
            {TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK}
        )
        self._allow_reduce_only = allow_reduce_only
        self._client_order_id_max_length = client_order_id_max_length

    def validate(
        self,
        intent: OrderIntent,
        *,
        specification: SymbolSpecification | None,
        reference_price: Decimal | None = None,
        now_micros: int | None = None,
    ) -> ValidationResult:
        """Run all ten checks and collect every failure."""
        now = epoch_micros() if now_micros is None else now_micros
        issues: list[ValidationIssue] = []

        # --- 1. Identity ----------------------------------------------
        if not intent.tenant_id or not intent.tenant_id.strip():
            issues.append(
                ValidationIssue(
                    ValidationCode.MISSING_TENANT,
                    "Order intent has no tenant id; it cannot be attributed or "
                    "authorised.",
                    "tenant_id",
                )
            )
        if not intent.account_id or not intent.account_id.strip():
            issues.append(
                ValidationIssue(
                    ValidationCode.MISSING_ACCOUNT,
                    "Order intent has no account id; there is no exchange "
                    "account to route it to.",
                    "account_id",
                )
            )
        if not intent.symbol or not intent.symbol.strip():
            issues.append(
                ValidationIssue(
                    ValidationCode.MISSING_SYMBOL,
                    "Order intent has no symbol.",
                    "symbol",
                )
            )

        if intent.client_order_id is not None:
            coid = intent.client_order_id
            if not coid or len(coid) > self._client_order_id_max_length:
                issues.append(
                    ValidationIssue(
                        ValidationCode.CLIENT_ORDER_ID_INVALID,
                        f"clientOrderId must be 1-{self._client_order_id_max_length} "
                        f"characters; got {len(coid)}.",
                        "client_order_id",
                    )
                )
            elif not all(ch.isalnum() or ch in "-_." for ch in coid):
                issues.append(
                    ValidationIssue(
                        ValidationCode.CLIENT_ORDER_ID_INVALID,
                        "clientOrderId may contain only alphanumerics, '-', '_' "
                        "and '.'; other characters break the signed query string.",
                        "client_order_id",
                    )
                )

        # --- 2. Symbol known and tradeable ----------------------------
        if specification is None:
            issues.append(
                ValidationIssue(
                    ValidationCode.UNKNOWN_SYMBOL,
                    f"No symbol specification for {intent.symbol!r} on "
                    f"{intent.exchange.value}. Refusing to guess the venue's "
                    f"lot size, tick size and minimum notional.",
                    "symbol",
                )
            )
        elif not specification.is_tradeable:
            issues.append(
                ValidationIssue(
                    ValidationCode.SYMBOL_NOT_TRADEABLE,
                    f"{intent.symbol} is currently not tradeable on "
                    f"{intent.exchange.value} (halted or delisted).",
                    "symbol",
                )
            )

        # --- 3. Side and type -----------------------------------------
        side_view: object = intent.side
        if not isinstance(side_view, OrderSide):
            issues.append(
                ValidationIssue(
                    ValidationCode.UNSUPPORTED_SIDE,
                    f"Unsupported order side {intent.side!r}.",
                    "side",
                )
            )
        order_type_view: object = intent.order_type
        if not isinstance(order_type_view, OrderType):
            issues.append(
                ValidationIssue(
                    ValidationCode.UNSUPPORTED_ORDER_TYPE,
                    f"Unsupported order type {intent.order_type!r}.",
                    "order_type",
                )
            )

        # --- 4. Quantity ----------------------------------------------
        quantity = intent.quantity
        if not _is_usable_decimal(quantity):
            issues.append(
                ValidationIssue(
                    ValidationCode.INVALID_QUANTITY,
                    f"Quantity must be a finite Decimal; got {quantity!r}.",
                    "quantity",
                )
            )
        elif quantity <= 0:
            issues.append(
                ValidationIssue(
                    ValidationCode.INVALID_QUANTITY,
                    f"Quantity must be greater than zero; got {quantity}.",
                    "quantity",
                )
            )

        # --- 5 & 6. Price and stop price against the order type -------
        requires_price = intent.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT)
        requires_stop = intent.order_type in (OrderType.STOP, OrderType.STOP_LIMIT)

        if requires_price:
            if intent.price is None:
                issues.append(
                    ValidationIssue(
                        ValidationCode.PRICE_REQUIRED,
                        f"A {intent.order_type.value} order requires a limit price.",
                        "price",
                    )
                )
            elif not _is_usable_decimal(intent.price) or intent.price <= 0:
                issues.append(
                    ValidationIssue(
                        ValidationCode.INVALID_PRICE,
                        f"Limit price must be a finite positive Decimal; got "
                        f"{intent.price!r}.",
                        "price",
                    )
                )
        elif intent.price is not None and intent.order_type is OrderType.MARKET:
            issues.append(
                ValidationIssue(
                    ValidationCode.PRICE_NOT_ALLOWED,
                    "A MARKET order must not carry a limit price; the venue "
                    "would reject it and the intent is ambiguous.",
                    "price",
                )
            )

        if requires_stop:
            if intent.stop_price is None:
                issues.append(
                    ValidationIssue(
                        ValidationCode.STOP_PRICE_REQUIRED,
                        f"A {intent.order_type.value} order requires a stop price.",
                        "stop_price",
                    )
                )
            elif not _is_usable_decimal(intent.stop_price) or intent.stop_price <= 0:
                issues.append(
                    ValidationIssue(
                        ValidationCode.INVALID_PRICE,
                        f"Stop price must be a finite positive Decimal; got "
                        f"{intent.stop_price!r}.",
                        "stop_price",
                    )
                )
        elif intent.stop_price is not None:
            issues.append(
                ValidationIssue(
                    ValidationCode.STOP_PRICE_NOT_ALLOWED,
                    f"A {intent.order_type.value} order must not carry a stop "
                    f"price.",
                    "stop_price",
                )
            )

        # --- 7. Venue lot/tick rules ----------------------------------
        # Reuses the Part 2 SymbolSpecification.validation_errors rather than
        # restating the arithmetic, then maps each message onto a code.
        if specification is not None and _is_usable_decimal(quantity) and quantity > 0:
            for message in specification.validation_errors(quantity, intent.price):
                issues.append(
                    ValidationIssue(
                        _classify_specification_error(message), message, None
                    )
                )

        # --- 8. Notional ceiling --------------------------------------
        effective_price = intent.price if intent.price is not None else reference_price
        if (
            self._max_notional is not None
            and effective_price is not None
            and _is_usable_decimal(quantity)
            and _is_usable_decimal(effective_price)
            and quantity > 0
        ):
            notional = quantity * effective_price
            if notional > self._max_notional:
                issues.append(
                    ValidationIssue(
                        ValidationCode.MAX_NOTIONAL_VIOLATION,
                        f"Order notional {notional} exceeds the platform ceiling "
                        f"{self._max_notional}.",
                        "quantity",
                    )
                )

        # --- 9. Time in force -----------------------------------------
        if intent.order_type is OrderType.MARKET:
            # A market order's TIF is implicit; the adapter omits it entirely.
            pass
        elif intent.time_in_force not in self._supported_time_in_force:
            supported = ", ".join(
                sorted(item.value for item in self._supported_time_in_force)
            )
            issues.append(
                ValidationIssue(
                    ValidationCode.UNSUPPORTED_TIME_IN_FORCE,
                    f"Time in force {intent.time_in_force.value} is not supported "
                    f"for this venue; supported values are {supported}.",
                    "time_in_force",
                )
            )

        if intent.reduce_only and not self._allow_reduce_only:
            issues.append(
                ValidationIssue(
                    ValidationCode.REDUCE_ONLY_UNSUPPORTED,
                    "reduce_only was requested but this venue has no reduce-only "
                    "flag. Silently dropping it could turn a closing order into "
                    "an opening one, so the order is refused.",
                    "reduce_only",
                )
            )

        # --- 10. Fat-finger price band --------------------------------
        if (
            intent.price is not None
            and reference_price is not None
            and _is_usable_decimal(intent.price)
            and _is_usable_decimal(reference_price)
            and reference_price > 0
            and intent.price > 0
        ):
            deviation = (
                abs(intent.price - reference_price) / reference_price * Decimal(100)
            )
            if deviation > self._price_band_percent:
                issues.append(
                    ValidationIssue(
                        ValidationCode.PRICE_BAND_VIOLATION,
                        f"Limit price {intent.price} deviates {deviation:.2f}% from "
                        f"the reference price {reference_price}, beyond the "
                        f"{self._price_band_percent}% sanity band. This is usually "
                        f"a decimal-point error.",
                        "price",
                    )
                )

        return ValidationResult(
            valid=not issues,
            issues=tuple(issues),
            validated_at_micros=now,
            specification=specification,
        )


def _classify_specification_error(message: str) -> ValidationCode:
    """Map a SymbolSpecification message onto a normalised code.

    The specification returns human text; the platform's contract is codes.
    Matching on stable substrings keeps the two in step without changing the
    Part 2 signature.
    """
    lowered = message.lower()
    if "not currently tradeable" in lowered:
        return ValidationCode.SYMBOL_NOT_TRADEABLE
    if "notional" in lowered:
        return ValidationCode.MIN_NOTIONAL_VIOLATION
    if "tick" in lowered:
        return ValidationCode.TICK_SIZE_VIOLATION
    if "step" in lowered or "minimum" in lowered or "maximum" in lowered:
        return ValidationCode.LOT_SIZE_VIOLATION
    return ValidationCode.INVALID_QUANTITY
