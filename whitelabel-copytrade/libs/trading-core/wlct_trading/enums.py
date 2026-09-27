"""Canonical trading enumerations shared by every data-plane service.

These values are the *internal* vocabulary of the platform. Exchange-specific
strings (``"NEW"``, ``"PARTIALLY_FILLED"``, ``"buy"``, ``"Sell"``, ...) are
translated at the adapter boundary and never leak past it, so a strategy can be
written once and run against any venue.

The string values are stable wire values: they are persisted to PostgreSQL,
published on Redis and returned by the REST API, so they must not be renamed
without a migration.
"""

from __future__ import annotations

from enum import Enum

__all__ = [
    "ExchangeId",
    "MarketType",
    "OrderSide",
    "OrderType",
    "TimeInForce",
    "OrderStatus",
    "TERMINAL_ORDER_STATUSES",
    "OPEN_ORDER_STATUSES",
    "PositionSide",
    "SignalAction",
    "TradingMode",
    "KillSwitchScope",
    "RiskDecisionCode",
    "TradingEventType",
    "OrderBookHealth",
    "StrategyStatus",
    "StrategyFailurePolicy",
    "SignalRejectionCode",
    "MarketEventKind",
    "MarketFillPriceModel",
    "LimitFillRule",
    "BacktestPhase",
    "DatasetStatus",
    "DatasetCompleteness",
    "DatasetValidationSeverity",
    "DatasetIngestionRunStatus",
    "HistoricalSourceKind",
    "RiskRuleId",
    "RISK_RULE_ORDER",
    "RISK_RULE_UNITS",
    "RiskLimitScope",
    "RISK_LIMIT_SCOPE_PRIORITY",
    "RiskLimitUnit",
    "RiskSwitchStatus",
    "RISK_SWITCH_TRANSITIONS",
    "ProtectionAction",
    "RiskEventSeverity",
    "RiskEventKind",
    "PriceReferenceKind",
    "KILL_SWITCH_SCOPE_PRIORITY",
]


class StrEnum(str, Enum):
    """``str`` mixin enum.

    Subclassing ``str`` means members serialise directly to JSON and compare
    equal to their wire value, which keeps Redis payloads and Prisma enum
    columns free of ``Enum.MEMBER`` repr leakage.
    """

    def __str__(self) -> str:  # pragma: no cover - trivial
        return str(self.value)


class ExchangeId(StrEnum):
    """Venues the platform knows how to talk to.

    Mirrors ``ExchangeId`` in ``packages/shared-types/src/exchange.ts``. The
    ``PAPER`` member is a first-class simulated venue used for paper trading;
    it is never a real exchange and every fill it produces is labelled
    simulated.
    """

    BINANCE = "binance"
    BYBIT = "bybit"
    OKX = "okx"
    KRAKEN = "kraken"
    PAPER = "paper"


class MarketType(StrEnum):
    SPOT = "SPOT"
    MARGIN = "MARGIN"
    FUTURES_USDT = "FUTURES_USDT"
    FUTURES_COIN = "FUTURES_COIN"


class OrderSide(StrEnum):
    BUY = "BUY"
    SELL = "SELL"

    @property
    def opposite(self) -> "OrderSide":
        return OrderSide.SELL if self is OrderSide.BUY else OrderSide.BUY

    @property
    def sign(self) -> int:
        """``+1`` for BUY, ``-1`` for SELL - used for signed position maths."""
        return 1 if self is OrderSide.BUY else -1


class OrderType(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP = "STOP"
    STOP_LIMIT = "STOP_LIMIT"

    @property
    def requires_price(self) -> bool:
        """LIMIT and STOP_LIMIT are the only types carrying a limit price."""
        return self in (OrderType.LIMIT, OrderType.STOP_LIMIT)

    @property
    def requires_stop_price(self) -> bool:
        """STOP and STOP_LIMIT are the only types carrying a trigger price."""
        return self in (OrderType.STOP, OrderType.STOP_LIMIT)


class TimeInForce(StrEnum):
    GTC = "GTC"
    IOC = "IOC"
    FOK = "FOK"
    DAY = "DAY"


class OrderStatus(StrEnum):
    """Lifecycle states of an order in the OMS.

    The legal transitions between these states are declared in
    ``wlct_trading.orders.ORDER_STATE_TRANSITIONS`` and enforced centrally, so
    an out-of-order or duplicated exchange callback can never corrupt an
    order's recorded history.
    """

    PENDING = "PENDING"
    SUBMITTED = "SUBMITTED"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCEL_REQUESTED = "CANCEL_REQUESTED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    FAILED = "FAILED"


#: States from which no further transition is possible.
TERMINAL_ORDER_STATUSES: frozenset[OrderStatus] = frozenset(
    {
        OrderStatus.FILLED,
        OrderStatus.CANCELLED,
        OrderStatus.REJECTED,
        OrderStatus.EXPIRED,
        OrderStatus.FAILED,
    }
)

#: States in which the order still consumes exposure and open-order budget.
OPEN_ORDER_STATUSES: frozenset[OrderStatus] = frozenset(
    {
        OrderStatus.PENDING,
        OrderStatus.SUBMITTED,
        OrderStatus.ACKNOWLEDGED,
        OrderStatus.PARTIALLY_FILLED,
        OrderStatus.CANCEL_REQUESTED,
    }
)


class PositionSide(StrEnum):
    LONG = "LONG"
    SHORT = "SHORT"
    FLAT = "FLAT"


class SignalAction(StrEnum):
    BUY = "BUY"
    SELL = "SELL"
    CLOSE = "CLOSE"
    HOLD = "HOLD"

    @property
    def is_actionable(self) -> bool:
        """``HOLD`` signals are recorded for observability but never routed."""
        return self is not SignalAction.HOLD


class TradingMode(StrEnum):
    """How order intents are resolved.

    ``DISABLED`` is the default everywhere. ``PAPER`` routes to the simulated
    venue. ``LIVE`` is the only mode that can reach a real exchange and it
    requires several independent environment variables to agree - see
    ``wlct_trading.risk.TradingModeResolver``.
    """

    DISABLED = "DISABLED"
    PAPER = "PAPER"
    LIVE = "LIVE"


class KillSwitchScope(StrEnum):
    """Granularity at which trading can be halted.

    Checked from broadest to narrowest; any engaged switch halts the order.

    Part 8 appended ``ACCOUNT`` and ``RISK``. They follow the same rule as the
    original four: engaged means halted, and a narrower switch can never
    release a broader one. ``ACCOUNT`` halts one trading account while the
    rest of the tenant keeps trading; ``RISK`` is the engine's own switch -
    engaged by automatic protection, cleared only by an operator (see
    ``RiskSwitchStatus``), never by a PnL recovery.
    """

    GLOBAL = "GLOBAL"
    EXCHANGE = "EXCHANGE"
    ACCOUNT = "ACCOUNT"
    STRATEGY = "STRATEGY"
    SYMBOL = "SYMBOL"
    RISK = "RISK"


#: Deterministic evaluation order for kill switches, broadest first. A
#: lower-priority (narrower) scope can never override an active switch of a
#: higher-priority (broader) one; this tuple is the single ordering authority
#: shared by the engine, the ledger and the admin surface.
KILL_SWITCH_SCOPE_PRIORITY: tuple[KillSwitchScope, ...] = (
    KillSwitchScope.GLOBAL,
    KillSwitchScope.EXCHANGE,
    KillSwitchScope.ACCOUNT,
    KillSwitchScope.RISK,
    KillSwitchScope.STRATEGY,
    KillSwitchScope.SYMBOL,
)


class RiskDecisionCode(StrEnum):
    """Machine-readable reason a risk check approved or refused an intent."""

    APPROVED = "APPROVED"
    KILL_SWITCH_ENGAGED = "KILL_SWITCH_ENGAGED"
    TRADING_DISABLED = "TRADING_DISABLED"
    STRATEGY_DISABLED = "STRATEGY_DISABLED"
    MAX_ORDER_SIZE_EXCEEDED = "MAX_ORDER_SIZE_EXCEEDED"
    MAX_ORDER_NOTIONAL_EXCEEDED = "MAX_ORDER_NOTIONAL_EXCEEDED"
    MAX_POSITION_SIZE_EXCEEDED = "MAX_POSITION_SIZE_EXCEEDED"
    MAX_SYMBOL_EXPOSURE_EXCEEDED = "MAX_SYMBOL_EXPOSURE_EXCEEDED"
    MAX_ACCOUNT_EXPOSURE_EXCEEDED = "MAX_ACCOUNT_EXPOSURE_EXCEEDED"
    MAX_OPEN_ORDERS_EXCEEDED = "MAX_OPEN_ORDERS_EXCEEDED"
    ORDER_RATE_EXCEEDED = "ORDER_RATE_EXCEEDED"
    DAILY_LOSS_LIMIT_BREACHED = "DAILY_LOSS_LIMIT_BREACHED"
    STRATEGY_LOSS_LIMIT_BREACHED = "STRATEGY_LOSS_LIMIT_BREACHED"
    PRICE_DEVIATION_EXCEEDED = "PRICE_DEVIATION_EXCEEDED"
    STALE_MARKET_DATA = "STALE_MARKET_DATA"
    DUPLICATE_ORDER = "DUPLICATE_ORDER"
    INVALID_INTENT = "INVALID_INTENT"
    SYMBOL_NOT_TRADEABLE = "SYMBOL_NOT_TRADEABLE"
    RISK_STATE_UNAVAILABLE = "RISK_STATE_UNAVAILABLE"

    # Part 8: the risk engine's extended verdict vocabulary. Every member here
    # maps to exactly one machine-readable condition the gate can prove; the
    # spec examples (MAX_ORDER_SIZE, MAX_DAILY_LOSS, ...) alias onto the
    # existing members where the semantics are identical - see
    # ``wlct_trading.risk.codes.DECISION_CODE_ALIASES``. Reusing the Part 2
    # vocabulary is deliberate: dashboards, incident rows and reconciliation
    # already key off these strings, and a second code namespace for the same
    # verdicts would guarantee drift.
    STALE_RISK_STATE = "STALE_RISK_STATE"
    INVALID_ACCOUNT_STATE = "INVALID_ACCOUNT_STATE"
    INVALID_POSITION_STATE = "INVALID_POSITION_STATE"
    INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE"
    MAX_POSITION_NOTIONAL_EXCEEDED = "MAX_POSITION_NOTIONAL_EXCEEDED"
    MAX_STRATEGY_EXPOSURE_EXCEEDED = "MAX_STRATEGY_EXPOSURE_EXCEEDED"
    MAX_DRAWDOWN_EXCEEDED = "MAX_DRAWDOWN_EXCEEDED"
    MAX_LEVERAGE_EXCEEDED = "MAX_LEVERAGE_EXCEEDED"
    CANCEL_RATE_EXCEEDED = "CANCEL_RATE_EXCEEDED"
    MAX_CONSECUTIVE_LOSSES_EXCEEDED = "MAX_CONSECUTIVE_LOSSES_EXCEEDED"
    TOO_MANY_ACTIVE_STRATEGIES = "TOO_MANY_ACTIVE_STRATEGIES"
    MAX_VOLUME_EXCEEDED = "MAX_VOLUME_EXCEEDED"
    FEE_BUDGET_EXCEEDED = "FEE_BUDGET_EXCEEDED"
    CORRELATION_GROUP_EXPOSURE_EXCEEDED = "CORRELATION_GROUP_EXPOSURE_EXCEEDED"
    RISK_CONFIGURATION_INVALID = "RISK_CONFIGURATION_INVALID"
    PROTECTION_ACTIVE = "PROTECTION_ACTIVE"
    UNKNOWN_RISK_RULE = "UNKNOWN_RISK_RULE"
    RISK_GATE_UNAVAILABLE = "RISK_GATE_UNAVAILABLE"


class TradingEventType(StrEnum):
    """Every event that can travel on the internal trading event bus.

    Part 3 added the connectivity and market-data lifecycle events. They share
    this one enum, and therefore the one bus, on purpose: an operator
    reconstructing an incident needs "the feed dropped" and "the order was
    rejected" on a single ordered timeline, which a second parallel bus would
    make impossible.
    """

    # -- Part 2: signal, order and position lifecycle ---------------------
    MARKET_DATA_RECEIVED = "MarketDataReceived"
    ORDER_BOOK_UPDATED = "OrderBookUpdated"
    TRADE_RECEIVED = "TradeReceived"
    SIGNAL_GENERATED = "SignalGenerated"
    RISK_CHECK_REQUESTED = "RiskCheckRequested"
    ORDER_REQUESTED = "OrderRequested"
    ORDER_SUBMITTED = "OrderSubmitted"
    ORDER_ACCEPTED = "OrderAccepted"
    ORDER_REJECTED = "OrderRejected"
    ORDER_PARTIALLY_FILLED = "OrderPartiallyFilled"
    ORDER_FILLED = "OrderFilled"
    ORDER_CANCELLED = "OrderCancelled"
    POSITION_UPDATED = "PositionUpdated"
    RISK_LIMIT_BREACHED = "RiskLimitBreached"

    # -- Part 3: connection lifecycle -------------------------------------
    MARKET_DATA_CONNECTED = "MarketDataConnected"
    MARKET_DATA_DISCONNECTED = "MarketDataDisconnected"
    MARKET_DATA_RECONNECTED = "MarketDataReconnected"

    # -- Part 3: market-data lifecycle ------------------------------------
    TICKER_RECEIVED = "TickerReceived"
    ORDER_BOOK_SNAPSHOT_RECEIVED = "OrderBookSnapshotReceived"
    ORDER_BOOK_INVALIDATED = "OrderBookInvalidated"
    ORDER_BOOK_RESYNC_STARTED = "OrderBookResyncStarted"
    ORDER_BOOK_RESYNC_COMPLETED = "OrderBookResyncCompleted"
    MARKET_DATA_STALE = "MarketDataStale"
    MARKET_DATA_RECOVERED = "MarketDataRecovered"

    # -- Part 3: subscription lifecycle -----------------------------------
    SUBSCRIPTION_CREATED = "SubscriptionCreated"
    SUBSCRIPTION_REMOVED = "SubscriptionRemoved"
    SUBSCRIPTION_FAILED = "SubscriptionFailed"

    # -- Part 6: strategy, backtest and paper-session lifecycle -----------
    STRATEGY_REGISTERED = "StrategyRegistered"
    STRATEGY_STARTED = "StrategyStarted"
    STRATEGY_STOPPED = "StrategyStopped"
    STRATEGY_FAILED = "StrategyFailed"
    STRATEGY_QUARANTINED = "StrategyQuarantined"
    SIGNAL_REJECTED = "SignalRejected"
    BACKTEST_STARTED = "BacktestStarted"
    BACKTEST_COMPLETED = "BacktestCompleted"
    PAPER_SESSION_STARTED = "PaperSessionStarted"
    PAPER_SESSION_STOPPED = "PaperSessionStopped"
    SIMULATED_ORDER_SUBMITTED = "SimulatedOrderSubmitted"
    SIMULATED_FILL = "SimulatedFill"

    # -- Part 8: risk engine lifecycle -------------------------------------
    # These ride the ONE bus. A second risk-local bus would split the timeline
    # that an operator reconstructs after an incident, which is exactly what
    # the Part 3 comment on this enum warned against.
    RISK_SNAPSHOT_UPDATED = "RiskSnapshotUpdated"
    RISK_EXPOSURE_UPDATED = "RiskExposureUpdated"
    RISK_STATE_STALE = "RiskStateStale"
    RISK_LIMIT_CHANGED = "RiskLimitChanged"
    KILL_SWITCH_ACTIVATED = "KillSwitchActivated"
    KILL_SWITCH_CLEARED = "KillSwitchCleared"
    KILL_SWITCH_ACKNOWLEDGED = "KillSwitchAcknowledged"
    PROTECTION_TRIGGERED = "ProtectionTriggered"
    PROTECTION_CLEARED = "ProtectionCleared"
    DAILY_LOSS_LIMIT_BREACHED = "DailyLossLimitBreached"
    ORDER_RATE_LIMIT_BREACHED = "OrderRateLimitBreached"
    CANCEL_RATE_LIMIT_BREACHED = "CancelRateLimitBreached"
    RISK_DECISION_REJECTED = "RiskDecisionRejected"
    RISK_DECISION_EXEMPTED = "RiskDecisionExempted"


class OrderBookHealth(StrEnum):
    """Whether a book may be trusted for pricing decisions.

    A book that is not ``OK`` must never be used to value an order. The risk
    engine treats anything else as unavailable state and fails closed.
    """

    OK = "OK"
    UNINITIALISED = "UNINITIALISED"
    RESYNC_REQUIRED = "RESYNC_REQUIRED"
    STALE = "STALE"
    CROSSED = "CROSSED"


class StrategyStatus(StrEnum):
    """Lifecycle status of one strategy *instance*.

    ``QUARANTINED`` is distinct from ``FAILED``: a quarantined instance is kept
    in the engine so an operator can inspect its last error and its state, but
    it receives no further events. Both are terminal for signal emission - a
    strategy whose state may be corrupted never emits again without an explicit
    operator action.
    """

    CREATED = "CREATED"
    INITIALISED = "INITIALISED"
    RUNNING = "RUNNING"
    STOPPED = "STOPPED"
    FAILED = "FAILED"
    QUARANTINED = "QUARANTINED"

    @property
    def can_emit_signals(self) -> bool:
        return self is StrategyStatus.RUNNING


class StrategyFailurePolicy(StrEnum):
    """What the engine does when a strategy instance raises.

    Every option is fail-closed. There is deliberately no ``CONTINUE`` member:
    an instance that raised may hold half-updated state, and continuing to
    trade from state that is known to be suspect is exactly the behaviour this
    enum exists to prevent.
    """

    #: Stop the offending instance. Other instances keep running.
    STOP_INSTANCE = "STOP_INSTANCE"
    #: Stop the offending instance but retain it for inspection.
    QUARANTINE_INSTANCE = "QUARANTINE_INSTANCE"
    #: Stop every instance in the engine. For strategies that share a book.
    HALT_ALL = "HALT_ALL"


class SignalRejectionCode(StrEnum):
    """Machine-readable reason the signal validator refused a signal.

    Signal validation sits *before* the risk engine and answers a different
    question: "is this signal well-formed, fresh, and permitted to exist?"
    Risk answers "is this trade within limits?". Keeping the vocabularies
    separate means an operator can tell a broken strategy from a risky one.
    """

    ACCEPTED = "ACCEPTED"
    STRUCTURALLY_INVALID = "STRUCTURALLY_INVALID"
    STRATEGY_UNKNOWN = "STRATEGY_UNKNOWN"
    STRATEGY_DISABLED = "STRATEGY_DISABLED"
    STRATEGY_NOT_RUNNING = "STRATEGY_NOT_RUNNING"
    STRATEGY_VERSION_MISSING = "STRATEGY_VERSION_MISSING"
    KILL_SWITCH_ENGAGED = "KILL_SWITCH_ENGAGED"
    SYMBOL_NOT_ALLOWED = "SYMBOL_NOT_ALLOWED"
    EXCHANGE_MISMATCH = "EXCHANGE_MISMATCH"
    TENANT_MISMATCH = "TENANT_MISMATCH"
    SIGNAL_EXPIRED = "SIGNAL_EXPIRED"
    SIGNAL_STALE = "SIGNAL_STALE"
    SIGNAL_FROM_FUTURE = "SIGNAL_FROM_FUTURE"
    MARKET_DATA_STALE = "MARKET_DATA_STALE"
    MARKET_DATA_UNAVAILABLE = "MARKET_DATA_UNAVAILABLE"
    DUPLICATE_SIGNAL = "DUPLICATE_SIGNAL"
    COOLDOWN_ACTIVE = "COOLDOWN_ACTIVE"
    QUANTITY_INVALID = "QUANTITY_INVALID"
    PRICE_INVALID = "PRICE_INVALID"
    VALIDATION_STATE_UNAVAILABLE = "VALIDATION_STATE_UNAVAILABLE"


class MarketEventKind(StrEnum):
    """The normalised market-event shapes a strategy can be driven by.

    The same four kinds are produced by the live feed and by the backtest
    replay engine, which is what allows one strategy implementation to run
    unchanged in ``BACKTEST``, ``PAPER`` and live-market-data modes.
    """

    TICKER = "TICKER"
    TRADE = "TRADE"
    BOOK_SNAPSHOT = "BOOK_SNAPSHOT"
    BOOK_DELTA = "BOOK_DELTA"
    CANDLE = "CANDLE"
    TIMER = "TIMER"


class MarketFillPriceModel(StrEnum):
    """How the simulator prices a marketable order.

    ``TOUCH`` crosses the spread and pays the opposite side's best price, which
    is the pessimistic and more realistic of the two. ``MID`` fills at the mid
    price and is provided only for comparison; it systematically flatters
    results by half the spread and is never the default.
    """

    TOUCH = "TOUCH"
    MID = "MID"


class LimitFillRule(StrEnum):
    """When the simulator considers a resting limit order executed.

    ``TOUCH_OR_BETTER`` fills when the opposite touch reaches the limit price.
    ``THROUGH_ONLY`` requires the market to trade strictly through the limit,
    which is a crude stand-in for queue position: it will not fill you merely
    because your price was equalled.
    """

    TOUCH_OR_BETTER = "TOUCH_OR_BETTER"
    THROUGH_ONLY = "THROUGH_ONLY"


class BacktestPhase(StrEnum):
    """Walk-forward period labels.

    The engine records which phase a run belongs to. It does **not** perform
    any optimisation or parameter search - that is deliberately out of scope,
    and a phase label on its own carries no statistical claim.
    """

    TRAINING = "TRAINING"
    VALIDATION = "VALIDATION"
    TEST = "TEST"
    FULL = "FULL"


# ---------------------------------------------------------------------------
# Part 7: historical dataset lifecycle
# ---------------------------------------------------------------------------
# These describe *stored data*, not trading. Nothing in this section can route
# an order: the dataset layer produces replay input for the Part 6 backtest
# engine and nothing else. The wire values mirror the Prisma enums of the same
# names, exactly as every other enum in this module does.


class DatasetStatus(StrEnum):
    """Lifecycle of one persisted dataset version.

    The payload of a version that has reached ``VALID`` is immutable: new data
    means a new version, never an edit. ``QUARANTINED`` and ``INVALID`` both
    refuse normal replay, but they are different human statements - "this may
    yet be explained" versus "this is wrong" - so they stay distinct rather
    than collapsing into one failure state.
    """

    CREATED = "CREATED"
    INGESTING = "INGESTING"
    VALIDATING = "VALIDATING"
    VALID = "VALID"
    INVALID = "INVALID"
    QUARANTINED = "QUARANTINED"
    ARCHIVED = "ARCHIVED"

    @property
    def usable_for_backtest(self) -> bool:
        """The one state a replay reader accepts without an override."""
        return self is DatasetStatus.VALID

    @property
    def payload_immutable(self) -> bool:
        """Whether the event payload may no longer be rewritten.

        True from ``VALID`` onwards, and also while a version is being
        quarantined or archived: those transitions touch status metadata only.
        """
        return self in (
            DatasetStatus.VALID,
            DatasetStatus.INVALID,
            DatasetStatus.QUARANTINED,
            DatasetStatus.ARCHIVED,
        )


class DatasetCompleteness(StrEnum):
    """Whether a dataset claims its whole promised window.

    ``PARTIAL`` datasets are legal - a capture that missed two days exists and
    is worth replaying - but the label must travel with every result computed
    over them, so a backtest never quietly pretends a hole is continuous time.
    """

    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    UNKNOWN = "UNKNOWN"


class DatasetValidationSeverity(StrEnum):
    """How much weight a validation finding carries.

    ``FATAL`` marks data whose internal consistency cannot be trusted for any
    purpose (a corrupted order-book sequence, an event from the wrong venue).
    ``ERROR`` marks data that must not enter a normal backtest but whose
    remains are still worth reading. ``WARNING`` and ``INFO`` report findings
    that a replay may legitimately run under - gaps, out-of-order tolerances -
    so the operator sees them in the quality report rather than in an
    exception.
    """

    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    FATAL = "FATAL"

    @property
    def blocks_dataset(self) -> bool:
        return self in (DatasetValidationSeverity.ERROR, DatasetValidationSeverity.FATAL)


class DatasetIngestionRunStatus(StrEnum):
    """Progress of one ingestion attempt.

    ``QUARANTINED`` as a run status means the run failed in a way that left
    evidence worth keeping; the dataset version it was writing never became
    ``VALID``. A failed run must never leave a half-written version visible -
    finalisation is atomic, and until it happens the version does not exist
    to readers.
    """

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    VALIDATING = "VALIDATING"
    FINALIZING = "FINALIZING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    QUARANTINED = "QUARANTINED"


class HistoricalSourceKind(StrEnum):
    """Where a historical dataset came from.

    Provenance is part of reproducibility: the same window captured from a
    venue's public archive and from a private replay of the same venue are
    different data even when their bytes agree, and a future reader is
    entitled to know which they hold. The values deliberately describe the
    *class* of source, not one specific bucket or host.
    """

    BINANCE_PUBLIC_DATA = "BINANCE_PUBLIC_DATA"
    LOCAL_FILES = "LOCAL_FILES"
    OBJECT_STORAGE_EXPORT = "OBJECT_STORAGE_EXPORT"
    DATABASE_EXPORT = "DATABASE_EXPORT"
    STREAM_CAPTURE = "STREAM_CAPTURE"


# ---------------------------------------------------------------------------
# Part 8: real-time risk engine
# ---------------------------------------------------------------------------
# The vocabulary of the authoritative risk gate. These enums describe *policy
# and protection*, never trading capability: nothing defined in this section
# can submit, cancel or route an order. The wire values mirror the Prisma
# enums of the same names, exactly as every other enum in this module does.


class RiskRuleId(StrEnum):
    """Stable machine identifiers for the Part 8 rule set.

    Rule ids are wire values: they appear in configuration documents, decision
    records, risk events and Prisma rows. Renaming one is a schema migration,
    not a refactor.

    Not every rule applies to every deployment: each rule declares its
    applicability (see ``wlct_trading.risk.rules``), and a rule that does not
    apply to the instrument or order type is reported as ``NOT_APPLICABLE``,
    never silently skipped and never invented.
    """

    MAX_ORDER_QUANTITY = "MAX_ORDER_QUANTITY"
    MAX_ORDER_NOTIONAL = "MAX_ORDER_NOTIONAL"
    MAX_POSITION_QUANTITY = "MAX_POSITION_QUANTITY"
    MAX_POSITION_NOTIONAL = "MAX_POSITION_NOTIONAL"
    MAX_ACCOUNT_EXPOSURE = "MAX_ACCOUNT_EXPOSURE"
    MAX_SYMBOL_EXPOSURE = "MAX_SYMBOL_EXPOSURE"
    MAX_STRATEGY_EXPOSURE = "MAX_STRATEGY_EXPOSURE"
    MAX_OPEN_ORDERS = "MAX_OPEN_ORDERS"
    MAX_DAILY_LOSS = "MAX_DAILY_LOSS"
    MAX_STRATEGY_DAILY_LOSS = "MAX_STRATEGY_DAILY_LOSS"
    MAX_DRAWDOWN = "MAX_DRAWDOWN"
    MAX_LEVERAGE = "MAX_LEVERAGE"
    MAX_ORDER_RATE = "MAX_ORDER_RATE"
    MAX_CANCEL_RATE = "MAX_CANCEL_RATE"
    MAX_PRICE_DEVIATION = "MAX_PRICE_DEVIATION"
    MAX_STALE_DATA_AGE = "MAX_STALE_DATA_AGE"
    MAX_CONSECUTIVE_LOSSES = "MAX_CONSECUTIVE_LOSSES"
    MAX_ACTIVE_STRATEGIES = "MAX_ACTIVE_STRATEGIES"
    MAX_TOTAL_VOLUME = "MAX_TOTAL_VOLUME"
    MAX_FEE_BUDGET = "MAX_FEE_BUDGET"
    MAX_CORRELATION_GROUP_EXPOSURE = "MAX_CORRELATION_GROUP_EXPOSURE"
    MAX_EXCHANGE_EXPOSURE = "MAX_EXCHANGE_EXPOSURE"


#: The rule evaluation order. Fixed and sorted, so two deployments that hold
#: identical configuration produce identical outcome sequences regardless of
#: insertion order anywhere upstream.
RISK_RULE_ORDER: tuple[RiskRuleId, ...] = (
    RiskRuleId.MAX_STALE_DATA_AGE,
    RiskRuleId.MAX_ORDER_QUANTITY,
    RiskRuleId.MAX_ORDER_NOTIONAL,
    RiskRuleId.MAX_POSITION_QUANTITY,
    RiskRuleId.MAX_POSITION_NOTIONAL,
    RiskRuleId.MAX_SYMBOL_EXPOSURE,
    RiskRuleId.MAX_STRATEGY_EXPOSURE,
    RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE,
    RiskRuleId.MAX_EXCHANGE_EXPOSURE,
    RiskRuleId.MAX_ACCOUNT_EXPOSURE,
    RiskRuleId.MAX_OPEN_ORDERS,
    RiskRuleId.MAX_ORDER_RATE,
    RiskRuleId.MAX_CANCEL_RATE,
    RiskRuleId.MAX_DAILY_LOSS,
    RiskRuleId.MAX_STRATEGY_DAILY_LOSS,
    RiskRuleId.MAX_DRAWDOWN,
    RiskRuleId.MAX_CONSECUTIVE_LOSSES,
    RiskRuleId.MAX_ACTIVE_STRATEGIES,
    RiskRuleId.MAX_TOTAL_VOLUME,
    RiskRuleId.MAX_FEE_BUDGET,
    RiskRuleId.MAX_PRICE_DEVIATION,
    RiskRuleId.MAX_LEVERAGE,
)


class RiskLimitScope(StrEnum):
    """Hierarchy level at which a limit is expressed.

    Resolution walks GLOBAL -> EXCHANGE -> ACCOUNT -> STRATEGY -> SYMBOL and
    the most restrictive applicable value wins at every level; a child can
    tighten, never widen (see ``wlct_trading.risk.configuration``).
    """

    GLOBAL = "GLOBAL"
    EXCHANGE = "EXCHANGE"
    ACCOUNT = "ACCOUNT"
    STRATEGY = "STRATEGY"
    SYMBOL = "SYMBOL"


#: Narrowest-last ordering of the limit hierarchy.
RISK_LIMIT_SCOPE_PRIORITY: tuple[RiskLimitScope, ...] = (
    RiskLimitScope.GLOBAL,
    RiskLimitScope.EXCHANGE,
    RiskLimitScope.ACCOUNT,
    RiskLimitScope.STRATEGY,
    RiskLimitScope.SYMBOL,
)


class RiskLimitUnit(StrEnum):
    """Dimension a limit value is expressed in.

    Units are validated against the rule they are attached to: a
    ``MAX_ORDER_RATE`` entry carrying ``NOTIONAL`` is a configuration error,
    not something to be guessed around at evaluation time.
    """

    BASE_QUANTITY = "BASE_QUANTITY"
    QUOTE_NOTIONAL = "QUOTE_NOTIONAL"
    COUNT = "COUNT"
    LOSS = "LOSS"
    PERCENT = "PERCENT"
    BPS = "BPS"
    AGE_MICROS = "AGE_MICROS"
    LEVERAGE_X = "LEVERAGE_X"


class RiskSwitchStatus(StrEnum):
    """Lifecycle of one kill switch record.

    ``TRIGGERED`` is the automatic-protection engagement: it carries the same
    halt as a manual ``ACTIVE`` switch but requires an explicit acknowledge
    followed by an explicit clear. A severe safety condition is never
    auto-cleared because PnL improved - the transition table refuses it.
    ``ACKNOWLEDGED`` keeps the switch engaged; it records that a human has
    read the trigger, nothing more. ``CLEARED`` is the terminal state of a
    record that was triggered and later cleared; releasing a manual switch
    returns it to ``INACTIVE``.
    """

    INACTIVE = "INACTIVE"
    ACTIVE = "ACTIVE"
    TRIGGERED = "TRIGGERED"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    CLEARED = "CLEARED"


#: Legal ``RiskSwitchStatus`` transitions. Anything absent is refused.
#: ``INACTIVE -> CLEARED`` is deliberately absent: you cannot "clear" a switch
#: that was never engaged, and a transition that exists only to erase a
#: mistake is how audit trails get rewritten.
RISK_SWITCH_TRANSITIONS: dict[RiskSwitchStatus, frozenset[RiskSwitchStatus]] = {
    RiskSwitchStatus.INACTIVE: frozenset(
        {RiskSwitchStatus.ACTIVE, RiskSwitchStatus.TRIGGERED}
    ),
    RiskSwitchStatus.ACTIVE: frozenset({RiskSwitchStatus.INACTIVE}),
    RiskSwitchStatus.TRIGGERED: frozenset(
        {RiskSwitchStatus.ACKNOWLEDGED, RiskSwitchStatus.CLEARED}
    ),
    RiskSwitchStatus.ACKNOWLEDGED: frozenset({RiskSwitchStatus.CLEARED}),
    RiskSwitchStatus.CLEARED: frozenset({RiskSwitchStatus.INACTIVE}),
}


class ProtectionAction(StrEnum):
    """What automatic protection does when a severe limit is breached.

    Ordered from least to most disruptive; the policy chooses one, and every
    action here *reduces* capability. There is deliberately no ``CLOSE_ALL``
    or ``LIQUIDATE`` member: automatically converting held positions into
    market orders is a bigger risk than the one being protected against, and
    this codebase will not build it by accident. A future forced-de-risking
    feature must arrive as its own explicitly authorised subsystem.
    """

    BLOCK_NEW_RISK = "BLOCK_NEW_RISK"
    BLOCK_SYMBOL = "BLOCK_SYMBOL"
    BLOCK_STRATEGY = "BLOCK_STRATEGY"
    BLOCK_ACCOUNT = "BLOCK_ACCOUNT"
    BLOCK_EXCHANGE = "BLOCK_EXCHANGE"
    GLOBAL_TRADING_STOP = "GLOBAL_TRADING_STOP"


class RiskEventSeverity(StrEnum):
    """How much weight a risk event carries.

    Mirrors the Part 7 validation-severity ladder in shape but not in meaning:
    ``EMERGENCY`` here always indicates the safety system itself is degraded
    (a corrupted snapshot, a fail-closed trip) rather than bad data.
    """

    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    EMERGENCY = "EMERGENCY"


class RiskEventKind(StrEnum):
    """What one persisted risk event records.

    The mirror of Prisma ``RiskEventType`` extended for Part 8. Events are
    the operator-facing trail: every transition of a protection state, every
    breach, and every config mutation lands here in addition to the audit
    log, because the audit log answers "who did it" and this answers "what
    the system decided and why".
    """

    LIMIT_BREACHED = "LIMIT_BREACHED"
    ORDER_REJECTED = "ORDER_REJECTED"
    KILL_SWITCH_ENGAGED = "KILL_SWITCH_ENGAGED"
    KILL_SWITCH_RELEASED = "KILL_SWITCH_RELEASED"
    KILL_SWITCH_TRIGGERED = "KILL_SWITCH_TRIGGERED"
    KILL_SWITCH_ACKNOWLEDGED = "KILL_SWITCH_ACKNOWLEDGED"
    KILL_SWITCH_CLEARED = "KILL_SWITCH_CLEARED"
    STALE_MARKET_DATA = "STALE_MARKET_DATA"
    STALE_RISK_STATE = "STALE_RISK_STATE"
    RISK_STATE_UNAVAILABLE = "RISK_STATE_UNAVAILABLE"
    DUPLICATE_ORDER_BLOCKED = "DUPLICATE_ORDER_BLOCKED"
    ORDER_BOOK_RESYNC = "ORDER_BOOK_RESYNC"
    PROTECTION_TRIGGERED = "PROTECTION_TRIGGERED"
    PROTECTION_CLEARED = "PROTECTION_CLEARED"
    #: A risk-reducing order admitted while a triggered protection stands.
    #: It is neither a breach nor a clear; hiding it in either would be the
    #: audit lie the exemption mechanism exists to avoid.
    PROTECTION_EXEMPTED = "PROTECTION_EXEMPTED"
    DAILY_LOSS_BREACHED = "DAILY_LOSS_BREACHED"
    ORDER_RATE_BREACHED = "ORDER_RATE_BREACHED"
    CANCEL_RATE_BREACHED = "CANCEL_RATE_BREACHED"
    CONSECUTIVE_LOSSES_BREACHED = "CONSECUTIVE_LOSSES_BREACHED"
    CONFIG_CHANGED = "CONFIG_CHANGED"


class PriceReferenceKind(StrEnum):
    """Which market number a price-deviation check measures against.

    Deliberately configurable per scope: the honest reference differs by
    order type (a market order is valued against the touch it will cross,
    not against a mid that never trades), and pretending one reference fits
    all orders is how deviation bands end up rubber-stamping fat fingers on
    one side of the book.
    """

    MID = "MID"
    BEST_BID = "BEST_BID"
    BEST_ASK = "BEST_ASK"
    SIDE_TOUCH = "SIDE_TOUCH"
    LAST_TRADE = "LAST_TRADE"


#: Which units each rule accepts. Enforced by configuration validation, and
#: by the gate when a hand-built entry bypasses the loader. A (rule, unit)
#: pair absent from this table is a hard configuration error.
RISK_RULE_UNITS: dict[RiskRuleId, frozenset[RiskLimitUnit]] = {
    RiskRuleId.MAX_ORDER_QUANTITY: frozenset({RiskLimitUnit.BASE_QUANTITY}),
    RiskRuleId.MAX_ORDER_NOTIONAL: frozenset({RiskLimitUnit.QUOTE_NOTIONAL}),
    RiskRuleId.MAX_POSITION_QUANTITY: frozenset({RiskLimitUnit.BASE_QUANTITY}),
    RiskRuleId.MAX_POSITION_NOTIONAL: frozenset({RiskLimitUnit.QUOTE_NOTIONAL}),
    RiskRuleId.MAX_ACCOUNT_EXPOSURE: frozenset({RiskLimitUnit.QUOTE_NOTIONAL}),
    RiskRuleId.MAX_SYMBOL_EXPOSURE: frozenset({RiskLimitUnit.QUOTE_NOTIONAL}),
    RiskRuleId.MAX_STRATEGY_EXPOSURE: frozenset({RiskLimitUnit.QUOTE_NOTIONAL}),
    RiskRuleId.MAX_OPEN_ORDERS: frozenset({RiskLimitUnit.COUNT}),
    RiskRuleId.MAX_DAILY_LOSS: frozenset({RiskLimitUnit.LOSS}),
    RiskRuleId.MAX_STRATEGY_DAILY_LOSS: frozenset({RiskLimitUnit.LOSS}),
    RiskRuleId.MAX_DRAWDOWN: frozenset({RiskLimitUnit.PERCENT}),
    RiskRuleId.MAX_LEVERAGE: frozenset({RiskLimitUnit.LEVERAGE_X}),
    RiskRuleId.MAX_ORDER_RATE: frozenset({RiskLimitUnit.COUNT}),
    RiskRuleId.MAX_CANCEL_RATE: frozenset({RiskLimitUnit.COUNT}),
    RiskRuleId.MAX_PRICE_DEVIATION: frozenset({RiskLimitUnit.BPS}),
    RiskRuleId.MAX_STALE_DATA_AGE: frozenset({RiskLimitUnit.AGE_MICROS}),
    RiskRuleId.MAX_CONSECUTIVE_LOSSES: frozenset({RiskLimitUnit.COUNT}),
    RiskRuleId.MAX_ACTIVE_STRATEGIES: frozenset({RiskLimitUnit.COUNT}),
    RiskRuleId.MAX_TOTAL_VOLUME: frozenset({RiskLimitUnit.QUOTE_NOTIONAL}),
    RiskRuleId.MAX_FEE_BUDGET: frozenset({RiskLimitUnit.QUOTE_NOTIONAL}),
    RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE: frozenset(
        {RiskLimitUnit.QUOTE_NOTIONAL}
    ),
    RiskRuleId.MAX_EXCHANGE_EXPOSURE: frozenset({RiskLimitUnit.QUOTE_NOTIONAL}),
}
