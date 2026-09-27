"""Pre-trade risk engine and kill switches.

This is the last gate before an order can reach a venue. Its governing rule is
**fail closed**: any condition the engine cannot positively verify results in a
rejection. Missing risk state, an unusable order book, a stale mark price, an
unreadable limit - all of them refuse the order. There is no code path in which
an unknown becomes an approval.

Checks are ordered cheapest-and-most-catastrophic first, so an engaged kill
switch short-circuits before any arithmetic runs.

Layering
--------
Three limit sets apply simultaneously and the tightest always wins:

1. **Platform** - hard ceilings from environment configuration.
2. **Account** - per trading account, set by the tenant admin.
3. **Strategy** - per strategy, set by whoever owns the strategy.

A strategy can restrict itself further; it can never widen a limit above it.

Part 8
------
This module is now the *core* of a package. Everything above is unchanged:
this file remains the Part 2/5 pre-trade gate that ``ExecutionEngine``, the
paper sessions and the backtest engine already call, and its public names
(``from wlct_trading.risk import RiskEngine``) resolve exactly as before via
the package barrel. What Part 8 adds lives beside it - a rule catalog,
versioned hierarchical configuration, a richer state snapshot, exposure
reservation, protections, rate windows, events, replay - and composes with
this engine rather than replacing it: the Part 8 gate runs this evaluation
first and can only ever tighten the verdict, never overturn a rejection.

The only edits inside this file are additive fields on ``RiskViolation`` and
``RiskDecision`` (defaulted, so every existing construction site is
byte-compatible) so that a Part 8 decision can carry the request identity,
rule provenance, snapshot version and latency metadata through the same
objects that already flow into ``ExecutionResult``, incidents and the API.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    ExchangeId,
    KillSwitchScope,
    RiskDecisionCode,
    RiskRuleId,
    TradingMode,
)
from wlct_trading.market_data import BookTop
from wlct_trading.orders import OrderIntent
from wlct_trading.risk.decisions import LatencyBreakdown

__all__ = [
    "RiskLimits",
    "RiskSnapshot",
    "KillSwitchState",
    "RiskViolation",
    "RiskDecision",
    "RiskEngine",
    "TradingModeResolver",
    "TradingModeError",
    "price_deviation_percent",
    # The decision code is part of the public surface: consumers persist and
    # compare RiskDecisionCode values returned by ``RiskDecision.code``. It
    # must be re-exported explicitly, not implicitly, so that ``from
    # wlct_trading.risk import RiskDecisionCode`` stays valid under
    # no-implicit-reexport (mypy strict).
    "RiskDecisionCode",
]

_ZERO = Decimal(0)
_HUNDRED = Decimal(100)


@dataclass(slots=True, frozen=True)
class RiskLimits:
    """One layer of limits.

    Every field is a hard ceiling. ``None`` means "this layer does not express
    an opinion" and defers to the other layers - it never means "unlimited".
    At least one layer must specify a value or :meth:`RiskEngine.evaluate`
    rejects with ``RISK_STATE_UNAVAILABLE``.
    """

    max_order_quantity: Decimal | None = None
    max_order_notional: Decimal | None = None
    max_position_quantity: Decimal | None = None
    max_symbol_exposure_notional: Decimal | None = None
    max_account_exposure_notional: Decimal | None = None
    max_open_orders: int | None = None
    max_orders_per_minute: int | None = None
    max_daily_loss: Decimal | None = None
    max_strategy_loss: Decimal | None = None
    max_price_deviation_percent: Decimal | None = None
    max_market_data_age_micros: int | None = None

    def tightest_with(self, other: "RiskLimits") -> "RiskLimits":
        """Combine two layers by taking the more restrictive of each field."""

        def pick_decimal(a: Decimal | None, b: Decimal | None) -> Decimal | None:
            if a is None:
                return b
            if b is None:
                return a
            return min(a, b)

        def pick_int(a: int | None, b: int | None) -> int | None:
            if a is None:
                return b
            if b is None:
                return a
            return min(a, b)

        return RiskLimits(
            max_order_quantity=pick_decimal(
                self.max_order_quantity, other.max_order_quantity
            ),
            max_order_notional=pick_decimal(
                self.max_order_notional, other.max_order_notional
            ),
            max_position_quantity=pick_decimal(
                self.max_position_quantity, other.max_position_quantity
            ),
            max_symbol_exposure_notional=pick_decimal(
                self.max_symbol_exposure_notional, other.max_symbol_exposure_notional
            ),
            max_account_exposure_notional=pick_decimal(
                self.max_account_exposure_notional, other.max_account_exposure_notional
            ),
            max_open_orders=pick_int(self.max_open_orders, other.max_open_orders),
            max_orders_per_minute=pick_int(
                self.max_orders_per_minute, other.max_orders_per_minute
            ),
            max_daily_loss=pick_decimal(self.max_daily_loss, other.max_daily_loss),
            max_strategy_loss=pick_decimal(
                self.max_strategy_loss, other.max_strategy_loss
            ),
            max_price_deviation_percent=pick_decimal(
                self.max_price_deviation_percent, other.max_price_deviation_percent
            ),
            max_market_data_age_micros=pick_int(
                self.max_market_data_age_micros, other.max_market_data_age_micros
            ),
        )


@dataclass(slots=True, frozen=True)
class KillSwitchState:
    """Which kill switches are currently engaged.

    Four independent scopes, checked broadest first. Any one of them engaged
    halts the order. Switches are stored in Redis so a single API call halts
    every worker in the fleet within one poll interval.
    """

    global_engaged: bool = False
    engaged_exchanges: frozenset[str] = field(default_factory=frozenset)
    engaged_strategies: frozenset[str] = field(default_factory=frozenset)
    engaged_symbols: frozenset[str] = field(default_factory=frozenset)
    reason: str | None = None

    def engaged_scope(
        self, exchange: ExchangeId, strategy_id: str | None, symbol: str
    ) -> KillSwitchScope | None:
        """Return the broadest engaged scope, or ``None`` if all are clear."""
        if self.global_engaged:
            return KillSwitchScope.GLOBAL
        if exchange.value in self.engaged_exchanges:
            return KillSwitchScope.EXCHANGE
        if strategy_id is not None and strategy_id in self.engaged_strategies:
            return KillSwitchScope.STRATEGY
        if symbol in self.engaged_symbols:
            return KillSwitchScope.SYMBOL
        return None


@dataclass(slots=True, frozen=True)
class RiskSnapshot:
    """Everything the engine needs to know about current exposure.

    Assembled from Redis hot state by the caller. It is a value object with no
    I/O so the engine stays pure and trivially testable.

    ``is_complete`` is the fail-closed flag: the loader sets it to ``False``
    when any part of the state could not be read, and the engine then refuses
    every order rather than evaluating against partial data.
    """

    position_quantity: Decimal
    symbol_exposure_notional: Decimal
    account_exposure_notional: Decimal
    open_order_count: int
    orders_in_last_minute: int
    realised_pnl_today: Decimal
    strategy_realised_pnl_today: Decimal
    reference_price: Decimal | None
    market_data_age_micros: int | None
    book_usable: bool
    is_complete: bool = True
    known_client_order_ids: frozenset[str] = field(default_factory=frozenset)


@dataclass(slots=True, frozen=True)
class RiskViolation:
    """One failed check.

    ``rule`` is a Part 8 addition: when the violation came from a named rule
    in the rule catalog, it carries the rule id so the decision, the risk
    event and the persisted row can all point at the same configuration
    entry. Violations produced by the core engine (kill switch, state
    integrity, structural checks) legitimately carry ``None`` - not every
    refusal is a limit breach, and pretending otherwise would force fake rule
    ids into places the hierarchy does not reach.
    """

    code: RiskDecisionCode
    message: str
    limit: str | None = None
    observed: str | None = None
    rule: RiskRuleId | None = None


@dataclass(slots=True, frozen=True)
class RiskDecision:
    """The engine's verdict.

    ``approved`` is true only when there are zero violations *and* the trading
    mode permits routing. Both conditions are recorded separately so an
    operator can tell "the order was risky" from "trading is switched off".

    The Part 8 fields are populated by the full gate
    (``wlct_trading.risk.evaluator.RiskGate``), which evaluates the same core
    checks through ``RiskEngine.evaluate`` and then layers the rule catalog
    on top. The core engine alone leaves them at their defaults: a decision
    produced without the extended state honestly says so (``snapshot_version``
    ``None``) rather than inventing a version it never read.
    """

    decision_id: str
    approved: bool
    code: RiskDecisionCode
    violations: tuple[RiskViolation, ...]
    trading_mode: TradingMode
    would_route: bool
    evaluated_at: int
    kill_switch_scope: KillSwitchScope | None = None
    # -- Part 8: request identity, provenance and latency ------------------
    request_id: str | None = None
    tenant_id: str | None = None
    account_id: str | None = None
    strategy_id: str | None = None
    exchange: ExchangeId | None = None
    symbol: str | None = None
    snapshot_version: int | None = None
    snapshot_created_at: int | None = None
    latency: LatencyBreakdown | None = None

    @property
    def rejection_summary(self) -> str:
        if not self.violations:
            return "approved"
        return "; ".join(v.message for v in self.violations)


class TradingModeError(Exception):
    """Raised when the configured trading mode is unsafe or contradictory."""


class TradingModeResolver:
    """Resolves the effective trading mode from explicit configuration.

    Live trading must be *impossible* to reach by accident, so it requires
    three independent settings to agree:

    * ``TRADING_MODE`` set literally to ``LIVE``
    * ``TRADING_ENABLED`` true
    * ``LIVE_TRADING_CONFIRMED`` true

    Anything missing, misspelled or contradictory resolves to ``DISABLED``.
    An omitted environment variable therefore yields no trading at all - never
    live trading.
    """

    __slots__ = ("_mode", "_trading_enabled", "_live_confirmed")

    def __init__(
        self,
        *,
        mode: str | None,
        trading_enabled: bool,
        live_confirmed: bool,
    ) -> None:
        self._mode = (mode or "").strip().upper()
        self._trading_enabled = trading_enabled
        self._live_confirmed = live_confirmed

    def resolve(self) -> TradingMode:
        if not self._trading_enabled:
            return TradingMode.DISABLED
        if self._mode == TradingMode.LIVE.value:
            if not self._live_confirmed:
                # Configured for live but not confirmed: refuse to trade at
                # all rather than silently downgrading to paper, because a
                # downgrade would hide a misconfiguration in production.
                return TradingMode.DISABLED
            return TradingMode.LIVE
        if self._mode == TradingMode.PAPER.value:
            return TradingMode.PAPER
        return TradingMode.DISABLED

    def describe(self) -> str:
        resolved = self.resolve()
        if resolved is TradingMode.DISABLED and self._mode == TradingMode.LIVE.value:
            return (
                "TRADING_MODE=LIVE but LIVE_TRADING_CONFIRMED is not set; "
                "trading is disabled."
            )
        return f"Trading mode resolved to {resolved.value}."


class RiskEngine:
    """Evaluates order intents against layered limits and kill switches.

    Pure and synchronous: no I/O, no clock dependency beyond a timestamp, no
    hidden state. The caller loads a :class:`RiskSnapshot` and passes it in,
    which makes every rule here directly unit-testable.
    """

    __slots__ = ("_platform_limits", "_evaluate_numeric_limits")

    def __init__(
        self,
        platform_limits: RiskLimits,
        *,
        evaluate_numeric_limits: bool = True,
    ) -> None:
        """``evaluate_numeric_limits=False`` runs the state-consistency gates
        only (sections 0-4: kill switch, completeness, structure, duplicate,
        enablement) and skips sections 5-7 (limit resolution, pricing,
        quantitative checks).

        That mode exists for exactly one consumer: the Part 8 gate
        (``wlct_trading.risk.evaluator.RiskGate``), which composes this
        engine for its state checks while its own rule catalog owns every
        numeric ceiling. Without the mode, the core's *weaker* numeric
        checks (current position only, no reservations, no protections
        proposal) would shadow the catalog's stronger ones for identical
        limits - a rejection would arrive labelled as a core violation and
        automatic protection would never trigger. Defaulting to True keeps
        every standalone construction (paper sessions, backtests without a
        gate, queue workers) byte-identical to Part 2/5 behaviour.
        """
        self._platform_limits = platform_limits
        self._evaluate_numeric_limits = evaluate_numeric_limits

    def evaluate(
        self,
        intent: OrderIntent,
        *,
        snapshot: RiskSnapshot,
        kill_switches: KillSwitchState,
        trading_mode: TradingMode,
        account_limits: RiskLimits | None = None,
        strategy_limits: RiskLimits | None = None,
        book_top: BookTop | None = None,
        symbol_tradeable: bool = True,
        strategy_enabled: bool = True,
    ) -> RiskDecision:
        """Run every check and return a decision.

        Never raises for a risk condition - a rejection is a normal outcome and
        is returned as data so it can be persisted and audited.
        """
        violations: list[RiskViolation] = []
        decision_id = str(uuid.uuid4())
        now = epoch_micros()

        # -- 0. Kill switches --------------------------------------------
        scope = kill_switches.engaged_scope(
            intent.exchange, intent.strategy_id, intent.symbol
        )
        if scope is not None:
            return RiskDecision(
                decision_id=decision_id,
                approved=False,
                code=RiskDecisionCode.KILL_SWITCH_ENGAGED,
                violations=(
                    RiskViolation(
                        code=RiskDecisionCode.KILL_SWITCH_ENGAGED,
                        message=(
                            f"{scope.value} kill switch is engaged"
                            + (f": {kill_switches.reason}" if kill_switches.reason else ".")
                        ),
                    ),
                ),
                trading_mode=trading_mode,
                would_route=False,
                evaluated_at=now,
                kill_switch_scope=scope,
            )

        # -- 1. Fail closed on incomplete state --------------------------
        if not snapshot.is_complete:
            return self._reject(
                decision_id,
                RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                "Risk state could not be fully loaded; refusing to submit the order.",
                trading_mode,
                now,
            )

        # -- 2. Structural validity --------------------------------------
        intent_errors = intent.validation_errors()
        if intent_errors:
            return self._reject(
                decision_id,
                RiskDecisionCode.INVALID_INTENT,
                "; ".join(intent_errors),
                trading_mode,
                now,
            )

        # -- 3. Duplicate protection -------------------------------------
        if (
            intent.client_order_id is not None
            and intent.client_order_id in snapshot.known_client_order_ids
        ):
            return self._reject(
                decision_id,
                RiskDecisionCode.DUPLICATE_ORDER,
                (
                    f"client_order_id {intent.client_order_id} has already been "
                    "submitted; refusing to duplicate the order."
                ),
                trading_mode,
                now,
            )

        # -- 4. Enablement ------------------------------------------------
        if not symbol_tradeable:
            return self._reject(
                decision_id,
                RiskDecisionCode.SYMBOL_NOT_TRADEABLE,
                f"Symbol {intent.symbol} is not enabled for trading.",
                trading_mode,
                now,
            )
        if not strategy_enabled:
            return self._reject(
                decision_id,
                RiskDecisionCode.STRATEGY_DISABLED,
                f"Strategy {intent.strategy_id} is disabled.",
                trading_mode,
                now,
            )
        if trading_mode is TradingMode.DISABLED:
            return self._reject(
                decision_id,
                RiskDecisionCode.TRADING_DISABLED,
                "Trading is disabled for this deployment.",
                trading_mode,
                now,
            )

        # -- 5-7. Limits, pricing and quantitative checks (skippable) ------
        if self._evaluate_numeric_limits:
            # 5. Resolve the effective limit set
            limits = self._platform_limits
            if account_limits is not None:
                limits = limits.tightest_with(account_limits)
            if strategy_limits is not None:
                limits = limits.tightest_with(strategy_limits)

            # 6. Pricing
            price, price_violation = self._resolve_price(
                intent, snapshot, book_top, limits
            )
            if price_violation is not None:
                return self._reject_with(
                    decision_id, price_violation, trading_mode, now
                )

            # 7. Quantitative limits
            violations.extend(self._check_order_size(intent, price, limits))
            violations.extend(
                self._check_position_size(intent, snapshot, price, limits)
            )
            violations.extend(self._check_exposure(intent, snapshot, price, limits))
            violations.extend(self._check_order_budget(snapshot, limits))
            violations.extend(self._check_loss_limits(snapshot, limits))
            violations.extend(
                self._check_price_deviation(intent, snapshot, book_top, limits)
            )

        approved = not violations
        # Re-testing ``trading_mode is not DISABLED`` here would be theatre:
        # the DISABLED case returns its own rejection above, so by this point
        # a routable decision is exactly an approved one. mypy strict correctly
        # calls the redundant identity check non-overlapping; the real guard
        # lives where it was found and stays there.
        return RiskDecision(
            decision_id=decision_id,
            approved=approved,
            code=RiskDecisionCode.APPROVED if approved else violations[0].code,
            violations=tuple(violations),
            trading_mode=trading_mode,
            would_route=approved,
            evaluated_at=now,
        )

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------
    def _resolve_price(
        self,
        intent: OrderIntent,
        snapshot: RiskSnapshot,
        book_top: BookTop | None,
        limits: RiskLimits,
    ) -> tuple[Decimal, RiskViolation | None]:
        """Determine the price used to value the order, or refuse.

        A limit order values at its own limit price. A market order must be
        valued from live market data, and if that data is unusable or stale the
        order is refused rather than valued from a guess.
        """
        if intent.price is not None:
            return intent.price, None

        if book_top is not None:
            if not snapshot.book_usable:
                return _ZERO, RiskViolation(
                    code=RiskDecisionCode.STALE_MARKET_DATA,
                    message=(
                        f"Order book for {intent.symbol} is not in a usable state; "
                        "refusing to price a market order."
                    ),
                )
            mid = book_top.mid_price
            if mid is not None:
                return mid, None

        if snapshot.reference_price is None:
            return _ZERO, RiskViolation(
                code=RiskDecisionCode.STALE_MARKET_DATA,
                message=(
                    f"No reference price available for {intent.symbol}; "
                    "refusing to value the order."
                ),
            )

        max_age = limits.max_market_data_age_micros
        if max_age is not None and snapshot.market_data_age_micros is not None:
            if snapshot.market_data_age_micros > max_age:
                return _ZERO, RiskViolation(
                    code=RiskDecisionCode.STALE_MARKET_DATA,
                    message=(
                        f"Market data for {intent.symbol} is "
                        f"{snapshot.market_data_age_micros}us old, exceeding the "
                        f"{max_age}us maximum."
                    ),
                    limit=str(max_age),
                    observed=str(snapshot.market_data_age_micros),
                )
        return snapshot.reference_price, None

    def _check_order_size(
        self, intent: OrderIntent, price: Decimal, limits: RiskLimits
    ) -> list[RiskViolation]:
        out: list[RiskViolation] = []

        if limits.max_order_quantity is None:
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                    message="No max order quantity is configured at any layer.",
                )
            )
        elif intent.quantity > limits.max_order_quantity:
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED,
                    message=(
                        f"Order quantity {intent.quantity} exceeds the maximum of "
                        f"{limits.max_order_quantity}."
                    ),
                    limit=str(limits.max_order_quantity),
                    observed=str(intent.quantity),
                )
            )

        notional = intent.quantity * price
        if limits.max_order_notional is None:
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                    message="No max order notional is configured at any layer.",
                )
            )
        elif notional > limits.max_order_notional:
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.MAX_ORDER_NOTIONAL_EXCEEDED,
                    message=(
                        f"Order notional {notional} exceeds the maximum of "
                        f"{limits.max_order_notional}."
                    ),
                    limit=str(limits.max_order_notional),
                    observed=str(notional),
                )
            )
        return out

    def _check_position_size(
        self,
        intent: OrderIntent,
        snapshot: RiskSnapshot,
        price: Decimal,
        limits: RiskLimits,
    ) -> list[RiskViolation]:
        """Check the position this order would produce, not the current one.

        ``reduce_only`` orders are exempt: an order that can only shrink
        exposure cannot breach a position ceiling.
        """
        if intent.reduce_only or limits.max_position_quantity is None:
            return []

        projected = abs(snapshot.position_quantity + intent.quantity * intent.side.sign)
        if projected > limits.max_position_quantity:
            return [
                RiskViolation(
                    code=RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED,
                    message=(
                        f"Resulting position {projected} would exceed the maximum of "
                        f"{limits.max_position_quantity}."
                    ),
                    limit=str(limits.max_position_quantity),
                    observed=str(projected),
                )
            ]
        return []

    def _check_exposure(
        self,
        intent: OrderIntent,
        snapshot: RiskSnapshot,
        price: Decimal,
        limits: RiskLimits,
    ) -> list[RiskViolation]:
        if intent.reduce_only:
            return []

        out: list[RiskViolation] = []
        added = intent.quantity * price

        if limits.max_symbol_exposure_notional is not None:
            projected = snapshot.symbol_exposure_notional + added
            if projected > limits.max_symbol_exposure_notional:
                out.append(
                    RiskViolation(
                        code=RiskDecisionCode.MAX_SYMBOL_EXPOSURE_EXCEEDED,
                        message=(
                            f"Symbol exposure {projected} would exceed the maximum of "
                            f"{limits.max_symbol_exposure_notional}."
                        ),
                        limit=str(limits.max_symbol_exposure_notional),
                        observed=str(projected),
                    )
                )

        if limits.max_account_exposure_notional is not None:
            projected = snapshot.account_exposure_notional + added
            if projected > limits.max_account_exposure_notional:
                out.append(
                    RiskViolation(
                        code=RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED,
                        message=(
                            f"Account exposure {projected} would exceed the maximum of "
                            f"{limits.max_account_exposure_notional}."
                        ),
                        limit=str(limits.max_account_exposure_notional),
                        observed=str(projected),
                    )
                )
        return out

    def _check_order_budget(
        self, snapshot: RiskSnapshot, limits: RiskLimits
    ) -> list[RiskViolation]:
        out: list[RiskViolation] = []

        if (
            limits.max_open_orders is not None
            and snapshot.open_order_count >= limits.max_open_orders
        ):
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.MAX_OPEN_ORDERS_EXCEEDED,
                    message=(
                        f"{snapshot.open_order_count} orders are already open, at the "
                        f"limit of {limits.max_open_orders}."
                    ),
                    limit=str(limits.max_open_orders),
                    observed=str(snapshot.open_order_count),
                )
            )

        if (
            limits.max_orders_per_minute is not None
            and snapshot.orders_in_last_minute >= limits.max_orders_per_minute
        ):
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.ORDER_RATE_EXCEEDED,
                    message=(
                        f"{snapshot.orders_in_last_minute} orders were sent in the last "
                        f"minute, at the limit of {limits.max_orders_per_minute}."
                    ),
                    limit=str(limits.max_orders_per_minute),
                    observed=str(snapshot.orders_in_last_minute),
                )
            )
        return out

    def _check_loss_limits(
        self, snapshot: RiskSnapshot, limits: RiskLimits
    ) -> list[RiskViolation]:
        """Loss limits compare *losses* (negative PnL) against a positive cap."""
        out: list[RiskViolation] = []

        if limits.max_daily_loss is not None and snapshot.realised_pnl_today < _ZERO:
            loss = -snapshot.realised_pnl_today
            if loss >= limits.max_daily_loss:
                out.append(
                    RiskViolation(
                        code=RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED,
                        message=(
                            f"Realised loss today of {loss} has reached the daily limit "
                            f"of {limits.max_daily_loss}."
                        ),
                        limit=str(limits.max_daily_loss),
                        observed=str(loss),
                    )
                )

        if (
            limits.max_strategy_loss is not None
            and snapshot.strategy_realised_pnl_today < _ZERO
        ):
            loss = -snapshot.strategy_realised_pnl_today
            if loss >= limits.max_strategy_loss:
                out.append(
                    RiskViolation(
                        code=RiskDecisionCode.STRATEGY_LOSS_LIMIT_BREACHED,
                        message=(
                            f"Strategy realised loss of {loss} has reached its limit of "
                            f"{limits.max_strategy_loss}."
                        ),
                        limit=str(limits.max_strategy_loss),
                        observed=str(loss),
                    )
                )
        return out

    def _check_price_deviation(
        self,
        intent: OrderIntent,
        snapshot: RiskSnapshot,
        book_top: BookTop | None,
        limits: RiskLimits,
    ) -> list[RiskViolation]:
        """Guard against fat-finger limit prices far from the market.

        Only applies when the intent carries its own price *and* an independent
        market reference exists to compare it against. The book mid is
        preferred over the cached reference price because it is the fresher of
        the two; a book that is not usable is ignored rather than trusted.
        """
        if intent.price is None or limits.max_price_deviation_percent is None:
            return []

        reference: Decimal | None = None
        if book_top is not None and snapshot.book_usable:
            reference = book_top.mid_price
        if reference is None:
            reference = snapshot.reference_price
        if reference is None or reference == _ZERO:
            # No independent reference: this specific check cannot run. The
            # order is not refused here because pricing already fails closed
            # for the market orders that genuinely depend on live data.
            return []

        deviation = price_deviation_percent(intent.price, reference)
        if deviation is None or deviation <= limits.max_price_deviation_percent:
            return []

        return [
            RiskViolation(
                code=RiskDecisionCode.PRICE_DEVIATION_EXCEEDED,
                message=(
                    f"Limit price {intent.price} deviates {deviation:.4f}% from the "
                    f"reference price {reference}, exceeding the maximum of "
                    f"{limits.max_price_deviation_percent}%."
                ),
                limit=str(limits.max_price_deviation_percent),
                observed=str(deviation),
            )
        ]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _reject(
        decision_id: str,
        code: RiskDecisionCode,
        message: str,
        trading_mode: TradingMode,
        now: int,
    ) -> RiskDecision:
        return RiskDecision(
            decision_id=decision_id,
            approved=False,
            code=code,
            violations=(RiskViolation(code=code, message=message),),
            trading_mode=trading_mode,
            would_route=False,
            evaluated_at=now,
        )

    @staticmethod
    def _reject_with(
        decision_id: str,
        violation: RiskViolation,
        trading_mode: TradingMode,
        now: int,
    ) -> RiskDecision:
        return RiskDecision(
            decision_id=decision_id,
            approved=False,
            code=violation.code,
            violations=(violation,),
            trading_mode=trading_mode,
            would_route=False,
            evaluated_at=now,
        )


def price_deviation_percent(price: Decimal, reference: Decimal) -> Decimal | None:
    """Absolute deviation of ``price`` from ``reference``, as a percentage."""
    if reference == _ZERO:
        return None
    return abs(price - reference) / reference * _HUNDRED
