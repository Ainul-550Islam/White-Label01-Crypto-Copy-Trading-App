"""wlct-trading-core: the shared trading data-plane library.

One implementation of the order book, the OMS state machine, the risk engine
and the position tracker, imported by every data-plane service
(``market-data``, ``trading-engine``, ``execution-engine``). Keeping these in a
library rather than copying them into each service is what guarantees that the
risk rules enforced at signal time are byte-for-byte the rules enforced at
submission time.

The library has zero runtime dependencies and opens no sockets, reads no
configuration and touches no database. The connectivity layer added in
:mod:`wlct_trading.transport` and :mod:`wlct_trading.exchanges` describes *how*
to talk to a venue - framing, sequencing, backoff, rate budgets - but the actual
socket and HTTP calls are injected by the host service. That is what keeps the
whole package installable and exhaustively testable on a machine with no
network, no broker and no database.

The concrete implementations of those injected calls live in
:mod:`wlct_trading.net`, an optional subpackage installed with the ``live``
extra. Nothing here imports it, deliberately: importing this module must never
pull in a network client. ``wlct_trading.net`` handles **public market data
only** - it holds no credentials and submits no orders.

Authenticated trading lives in :mod:`wlct_trading.execution`, added in Part 5.
It is likewise not imported here. That is not an accident of layout: a service
that only needs market data should not be able to reach a module capable of
signing an order, and an explicit ``from wlct_trading.execution import ...`` is
a visible, greppable declaration that a component is in the money path.

The Part 6 strategy layer follows the same rule. :mod:`wlct_trading.strategies`
(features, strategy instances, signal validation, lifecycle),
:mod:`wlct_trading.backtest` (replay, simulated matching, portfolio, metrics)
and :mod:`wlct_trading.paper` (paper sessions) are importable but not
re-exported here, so a component that runs strategy code has to say so in its
imports. The shared vocabulary they depend on - :class:`Signal`,
:class:`BaseStrategy`, :class:`StrategyDescriptor`, the enums and the metrics
types - is exported below, because that vocabulary is genuinely shared.

None of those packages can reach an exchange. A strategy receives normalised
market data and returns a signal; the risk engine and the execution engine
decide what happens next.
"""

from wlct_trading.clock import (
    LatencyRecorder,
    LatencySpan,
    epoch_micros,
    epoch_millis,
    monotonic_nanos,
)
from wlct_trading.enums import (
    OPEN_ORDER_STATUSES,
    TERMINAL_ORDER_STATUSES,
    BacktestPhase,
    ExchangeId,
    KillSwitchScope,
    LimitFillRule,
    MarketEventKind,
    MarketFillPriceModel,
    MarketType,
    OrderBookHealth,
    OrderSide,
    OrderStatus,
    OrderType,
    PositionSide,
    RiskDecisionCode,
    SignalAction,
    SignalRejectionCode,
    StrategyFailurePolicy,
    StrategyStatus,
    TimeInForce,
    TradingEventType,
    TradingMode,
)
from wlct_trading.events import EventBus, InMemoryEventBus, TradingEvent
from wlct_trading.idempotency import (
    DuplicateOrderGuard,
    build_client_order_id,
    intent_fingerprint,
)
from wlct_trading.exchanges import (
    ExchangeCapabilities,
    ExchangeRegistration,
    ExchangeRegistry,
    SymbolMapping,
    SymbolRegistry,
    UnsupportedExchange,
    build_default_registry,
    to_canonical,
)
from wlct_trading.market_data import (
    BookTop,
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
    PublicTrade,
    SymbolRef,
    Ticker,
)
from wlct_trading.metrics import (
    EXECUTION_STAGES,
    STRATEGY_STAGES,
    ConnectivityMetrics,
    ExecutionCounters,
    ExecutionMetrics,
    LatencyHistogram,
    StrategyCounters,
    StrategyMetrics,
    StreamMetrics,
)
from wlct_trading.order_book import BookApplyResult, DepthView, OrderBook
from wlct_trading.orderbook_sync import (
    OrderBookSynchroniser,
    SyncConfig,
    SyncOutcome,
    SyncPhase,
)
from wlct_trading.orders import (
    ORDER_STATE_TRANSITIONS,
    Fill,
    InvalidOrderTransition,
    Order,
    OrderEvent,
    OrderIntent,
    is_legal_transition,
)
from wlct_trading.positions import Position, PositionManager, PositionUpdate
from wlct_trading.redis_keys import TRADING_STREAM, RedisKeys
from wlct_trading.risk import (
    KillSwitchState,
    RiskDecision,
    RiskEngine,
    RiskLimits,
    RiskSnapshot,
    RiskViolation,
    TradingModeResolver,
)
from wlct_trading.transport import (
    BackoffConfig,
    ConnectionCallbacks,
    ConnectionConfig,
    ConnectionHealth,
    ConnectionState,
    ExchangeErrorCategory,
    ExponentialBackoff,
    MarketDataChannel,
    NormalisedExchangeError,
    RateLimitRegistry,
    RateLimitRule,
    StalenessMonitor,
    StalenessThresholds,
    Subscription,
    SubscriptionManager,
    SubscriptionStatus,
    WebSocketConnectionManager,
    WebSocketTransport,
)
from wlct_trading.signals import (
    BaseStrategy,
    Signal,
    SignalValidationError,
    StrategyDescriptor,
    StrategyRiskProfile,
    signal_to_intent,
)

__version__ = "0.6.0"

__all__ = [
    "__version__",
    "BackoffConfig",
    "BacktestPhase",
    "BaseStrategy",
    "BookApplyResult",
    "BookTop",
    "build_client_order_id",
    "build_default_registry",
    "Candle",
    "ConnectionCallbacks",
    "ConnectionConfig",
    "ConnectionHealth",
    "ConnectionState",
    "ConnectivityMetrics",
    "DepthView",
    "DuplicateOrderGuard",
    "epoch_micros",
    "epoch_millis",
    "EventBus",
    "ExchangeCapabilities",
    "ExchangeErrorCategory",
    "ExchangeId",
    "ExchangeRegistration",
    "ExchangeRegistry",
    "EXECUTION_STAGES",
    "ExecutionCounters",
    "ExecutionMetrics",
    "ExponentialBackoff",
    "Fill",
    "InMemoryEventBus",
    "intent_fingerprint",
    "InvalidOrderTransition",
    "is_legal_transition",
    "KillSwitchScope",
    "KillSwitchState",
    "LatencyHistogram",
    "LatencyRecorder",
    "LatencySpan",
    "LimitFillRule",
    "MarketDataChannel",
    "MarketEventKind",
    "MarketFillPriceModel",
    "MarketType",
    "monotonic_nanos",
    "NormalisedExchangeError",
    "OPEN_ORDER_STATUSES",
    "Order",
    "ORDER_STATE_TRANSITIONS",
    "OrderBook",
    "OrderBookDelta",
    "OrderBookHealth",
    "OrderBookSnapshot",
    "OrderBookSynchroniser",
    "OrderEvent",
    "OrderIntent",
    "OrderSide",
    "OrderStatus",
    "OrderType",
    "Position",
    "PositionManager",
    "PositionSide",
    "PositionUpdate",
    "PriceLevel",
    "PublicTrade",
    "RateLimitRegistry",
    "RateLimitRule",
    "RedisKeys",
    "RiskDecision",
    "RiskDecisionCode",
    "RiskEngine",
    "RiskLimits",
    "RiskSnapshot",
    "RiskViolation",
    "Signal",
    "signal_to_intent",
    "SignalAction",
    "SignalRejectionCode",
    "SignalValidationError",
    "StalenessMonitor",
    "StalenessThresholds",
    "STRATEGY_STAGES",
    "StrategyCounters",
    "StrategyDescriptor",
    "StrategyFailurePolicy",
    "StrategyMetrics",
    "StrategyRiskProfile",
    "StrategyStatus",
    "StreamMetrics",
    "Subscription",
    "SubscriptionManager",
    "SubscriptionStatus",
    "SymbolMapping",
    "SymbolRef",
    "SymbolRegistry",
    "SyncConfig",
    "SyncOutcome",
    "SyncPhase",
    "TERMINAL_ORDER_STATUSES",
    "Ticker",
    "TimeInForce",
    "to_canonical",
    "TRADING_STREAM",
    "TradingEvent",
    "TradingEventType",
    "TradingMode",
    "TradingModeResolver",
    "UnsupportedExchange",
    "WebSocketConnectionManager",
    "WebSocketTransport",
]
