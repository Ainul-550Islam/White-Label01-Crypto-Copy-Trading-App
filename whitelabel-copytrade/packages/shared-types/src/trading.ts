/**
 * Trading domain contracts (Part 2).
 *
 * These types are the wire contract between the NestJS API, the Next.js admin
 * console and the Flutter app. They mirror the Python definitions in
 * `libs/trading-core/wlct_trading/enums.py`; the string values are identical on
 * both sides and are persisted to PostgreSQL, so renaming one requires a
 * migration and a coordinated change in both languages.
 *
 * SECURITY: nothing in this file describes a credential. There is deliberately
 * no `apiKey`, `apiSecret` or `passphrase` field on any view type. The only
 * credential-adjacent value a client ever receives is
 * `TradingAccountView.apiKeyLastFour`, which is four non-secret characters kept
 * purely so a user can tell two of their own keys apart.
 */

// `DecimalString` is defined once in `./common` and re-used here rather than
// redeclared: `number` is IEEE-754 and cannot represent `0.1` exactly, so
// serialising a price through it silently corrupts the value.
import type { DecimalString } from './common';

// -----------------------------------------------------------------------------
// Enumerations
// -----------------------------------------------------------------------------

export enum TradingVenue {
  BINANCE = 'BINANCE',
  BYBIT = 'BYBIT',
  OKX = 'OKX',
  KRAKEN = 'KRAKEN',
  /** Simulated venue. Every fill it produces is flagged as simulated. */
  PAPER = 'PAPER',
}

export enum TradingMarketType {
  SPOT = 'SPOT',
  MARGIN = 'MARGIN',
  FUTURES_USDT = 'FUTURES_USDT',
  FUTURES_COIN = 'FUTURES_COIN',
}

export enum TradingAccountStatus {
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  CREDENTIALS_INVALID = 'CREDENTIALS_INVALID',
  WITHDRAWAL_ENABLED_REJECTED = 'WITHDRAWAL_ENABLED_REJECTED',
}

/**
 * Resolved trading mode.
 *
 * `DISABLED` is the default in every environment. Reaching `LIVE` requires the
 * account setting, `TRADING_ENABLED`, `TRADING_MODE=LIVE` and
 * `LIVE_TRADING_CONFIRMED` to all agree — an omitted variable can therefore
 * never produce live trading.
 */
export enum TradingMode {
  DISABLED = 'DISABLED',
  PAPER = 'PAPER',
  LIVE = 'LIVE',
}

export enum StrategyStatus {
  DRAFT = 'DRAFT',
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
  ERROR = 'ERROR',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
}

export enum TimeInForce {
  GTC = 'GTC',
  IOC = 'IOC',
  FOK = 'FOK',
  DAY = 'DAY',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCEL_REQUESTED = 'CANCEL_REQUESTED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

/** Statuses from which no further transition is possible. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = Object.freeze([
  OrderStatus.FILLED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.EXPIRED,
  OrderStatus.FAILED,
]);

/** Statuses in which the order still consumes exposure and open-order budget. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = Object.freeze([
  OrderStatus.PENDING,
  OrderStatus.SUBMITTED,
  OrderStatus.ACKNOWLEDGED,
  OrderStatus.PARTIALLY_FILLED,
  OrderStatus.CANCEL_REQUESTED,
]);

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function isOpenOrderStatus(status: OrderStatus): boolean {
  return OPEN_ORDER_STATUSES.includes(status);
}

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT',
}

export enum SignalAction {
  BUY = 'BUY',
  SELL = 'SELL',
  CLOSE = 'CLOSE',
  HOLD = 'HOLD',
}

/**
 * The scopes at which trading can be halted, broadest first.
 *
 * Part 5 shipped GLOBAL/EXCHANGE/STRATEGY/SYMBOL for operational halts.
 * Part 8 added ACCOUNT (halt one trading account) and RISK (the engine's
 * emergency brake, target `account:<id>` - halts new risk-bearing
 * submissions while letting risk-reducing orders through). The EXECUTION
 * console cannot operate the two new scopes; the risk console operates
 * ACCOUNT/STRATEGY/SYMBOL and never GLOBAL/EXCHANGE. The split is enforced
 * at each surface's DTO, not by this enum.
 */
export enum KillSwitchScope {
  GLOBAL = 'GLOBAL',
  EXCHANGE = 'EXCHANGE',
  ACCOUNT = 'ACCOUNT',
  RISK = 'RISK',
  STRATEGY = 'STRATEGY',
  SYMBOL = 'SYMBOL',
}

export enum RiskEventType {
  LIMIT_BREACHED = 'LIMIT_BREACHED',
  ORDER_REJECTED = 'ORDER_REJECTED',
  KILL_SWITCH_ENGAGED = 'KILL_SWITCH_ENGAGED',
  KILL_SWITCH_RELEASED = 'KILL_SWITCH_RELEASED',
  STALE_MARKET_DATA = 'STALE_MARKET_DATA',
  RISK_STATE_UNAVAILABLE = 'RISK_STATE_UNAVAILABLE',
  DUPLICATE_ORDER_BLOCKED = 'DUPLICATE_ORDER_BLOCKED',
  ORDER_BOOK_RESYNC = 'ORDER_BOOK_RESYNC',
}

export enum RiskEventSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

/** Machine-readable reason the risk engine approved or refused an intent. */
export enum RiskDecisionCode {
  APPROVED = 'APPROVED',
  KILL_SWITCH_ENGAGED = 'KILL_SWITCH_ENGAGED',
  TRADING_DISABLED = 'TRADING_DISABLED',
  STRATEGY_DISABLED = 'STRATEGY_DISABLED',
  MAX_ORDER_SIZE_EXCEEDED = 'MAX_ORDER_SIZE_EXCEEDED',
  MAX_ORDER_NOTIONAL_EXCEEDED = 'MAX_ORDER_NOTIONAL_EXCEEDED',
  MAX_POSITION_SIZE_EXCEEDED = 'MAX_POSITION_SIZE_EXCEEDED',
  MAX_SYMBOL_EXPOSURE_EXCEEDED = 'MAX_SYMBOL_EXPOSURE_EXCEEDED',
  MAX_ACCOUNT_EXPOSURE_EXCEEDED = 'MAX_ACCOUNT_EXPOSURE_EXCEEDED',
  MAX_OPEN_ORDERS_EXCEEDED = 'MAX_OPEN_ORDERS_EXCEEDED',
  ORDER_RATE_EXCEEDED = 'ORDER_RATE_EXCEEDED',
  DAILY_LOSS_LIMIT_BREACHED = 'DAILY_LOSS_LIMIT_BREACHED',
  STRATEGY_LOSS_LIMIT_BREACHED = 'STRATEGY_LOSS_LIMIT_BREACHED',
  PRICE_DEVIATION_EXCEEDED = 'PRICE_DEVIATION_EXCEEDED',
  STALE_MARKET_DATA = 'STALE_MARKET_DATA',
  DUPLICATE_ORDER = 'DUPLICATE_ORDER',
  INVALID_INTENT = 'INVALID_INTENT',
  SYMBOL_NOT_TRADEABLE = 'SYMBOL_NOT_TRADEABLE',
  RISK_STATE_UNAVAILABLE = 'RISK_STATE_UNAVAILABLE',
}

export enum TradingSessionStatus {
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  DEGRADED = 'DEGRADED',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
}

/** Whether an order book may be trusted for pricing. Only `OK` qualifies. */
export enum OrderBookHealth {
  OK = 'OK',
  UNINITIALISED = 'UNINITIALISED',
  RESYNC_REQUIRED = 'RESYNC_REQUIRED',
  STALE = 'STALE',
  CROSSED = 'CROSSED',
}

/** Every event that can travel on the internal trading event bus. */
export enum TradingEventType {
  MARKET_DATA_RECEIVED = 'MarketDataReceived',
  ORDER_BOOK_UPDATED = 'OrderBookUpdated',
  TRADE_RECEIVED = 'TradeReceived',
  SIGNAL_GENERATED = 'SignalGenerated',
  RISK_CHECK_REQUESTED = 'RiskCheckRequested',
  ORDER_REQUESTED = 'OrderRequested',
  ORDER_SUBMITTED = 'OrderSubmitted',
  ORDER_ACCEPTED = 'OrderAccepted',
  ORDER_REJECTED = 'OrderRejected',
  ORDER_PARTIALLY_FILLED = 'OrderPartiallyFilled',
  ORDER_FILLED = 'OrderFilled',
  ORDER_CANCELLED = 'OrderCancelled',
  POSITION_UPDATED = 'PositionUpdated',
  RISK_LIMIT_BREACHED = 'RiskLimitBreached',
}

// -----------------------------------------------------------------------------
// Read models returned by the API
// -----------------------------------------------------------------------------

export interface ExchangeView {
  id: string;
  venue: TradingVenue;
  name: string;
  isEnabled: boolean;
  tradingEnabled: boolean;
  supportedMarketTypes: TradingMarketType[];
  requiresPassphrase: boolean;
  supportsSandbox: boolean;
  maxLeverage: number;
  weightLimitPerMinute: number;
  maxOrdersPerSecond: number;
}

/**
 * A tenant's connection to a venue.
 *
 * Contains no credential material by construction. `apiKeyLastFour` is the only
 * key-derived value present and is not secret.
 */
export interface TradingAccountView {
  id: string;
  tenantId: string;
  exchangeId: string;
  venue: TradingVenue;
  userId: string | null;
  label: string;
  status: TradingAccountStatus;
  marketType: TradingMarketType;
  tradingMode: TradingMode;
  isSandbox: boolean;
  apiKeyLastFour: string;
  canTrade: boolean;
  canReadData: boolean;
  /** Always false on a usable account; a true value means the key was refused. */
  canWithdraw: boolean;
  ipRestricted: boolean;
  lastVerifiedAt: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface TradingSymbolView {
  id: string;
  tenantId: string;
  exchangeId: string;
  venue: TradingVenue;
  symbol: string;
  venueSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  marketType: TradingMarketType;
  isTradeable: boolean;
  isSubscribed: boolean;
  priceTick: DecimalString;
  quantityStep: DecimalString;
  minQuantity: DecimalString;
  maxQuantity: DecimalString | null;
  minNotional: DecimalString;
  pricePrecision: number;
  quantityPrecision: number;
  maxOrderNotional: DecimalString | null;
}

export interface StrategyRiskProfileView {
  maxOrderQuantity: DecimalString;
  maxPositionQuantity: DecimalString;
  maxOrderNotional: DecimalString;
  maxDailyLoss: DecimalString;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
}

export interface StrategyView {
  id: string;
  tenantId: string;
  accountId: string | null;
  name: string;
  kind: string;
  version: string;
  status: StrategyStatus;
  enabled: boolean;
  venue: TradingVenue;
  symbols: string[];
  marketType: TradingMarketType;
  description: string | null;
  riskProfile: StrategyRiskProfileView;
  activeConfigurationVersion: number | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyConfigurationView {
  id: string;
  strategyId: string;
  version: number;
  parameters: Record<string, unknown>;
  isActive: boolean;
  activatedAt: string | null;
  changeNote: string | null;
  createdAt: string;
}

export interface OrderView {
  id: string;
  tenantId: string;
  accountId: string;
  strategyId: string | null;
  symbolId: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  signalId: string | null;
  venue: TradingVenue;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  quantity: DecimalString;
  price: DecimalString | null;
  stopPrice: DecimalString | null;
  reduceOnly: boolean;
  filledQuantity: DecimalString;
  remainingQuantity: DecimalString;
  averageFillPrice: DecimalString | null;
  cumulativeFee: DecimalString;
  feeCurrency: string | null;
  /** True when this order was executed on the simulated venue. */
  isSimulated: boolean;
  rejectionCode: string | null;
  rejectionReason: string | null;
  submitLatencyMicros: number | null;
  createdAt: string;
  submittedAt: string | null;
  terminalAt: string | null;
}

export interface OrderEventView {
  id: string;
  orderId: string;
  previousStatus: OrderStatus | null;
  status: OrderStatus;
  reason: string | null;
  occurredAtMicros: string;
  createdAt: string;
}

export interface FillView {
  id: string;
  orderId: string;
  venueTradeId: string;
  price: DecimalString;
  quantity: DecimalString;
  fee: DecimalString;
  feeCurrency: string;
  isMaker: boolean;
  /** True for paper fills. Never mutated after insert. */
  isSimulated: boolean;
  exchangeTimestampMicros: string;
  receivedTimestampMicros: string;
}

export interface PositionView {
  id: string;
  tenantId: string;
  accountId: string;
  symbolId: string;
  venue: TradingVenue;
  symbol: string;
  /** Signed: positive long, negative short, zero flat. */
  quantity: DecimalString;
  side: PositionSide;
  averageEntryPrice: DecimalString | null;
  markPrice: DecimalString | null;
  realisedPnl: DecimalString;
  /** Null when no mark price was available — never defaulted to zero. */
  unrealisedPnl: DecimalString | null;
  cumulativeFee: DecimalString;
  feeCurrency: string | null;
  /** True if any contributing fill was simulated. Sticky once set. */
  containsSimulatedFills: boolean;
  fillCount: number;
  openedAt: string | null;
  lastFillAt: string | null;
  updatedAt: string;
}

export interface RiskConfigurationView {
  id: string;
  tenantId: string;
  accountId: string;
  maxOrderQuantity: DecimalString;
  maxOrderNotional: DecimalString;
  maxPositionQuantity: DecimalString;
  maxSymbolExposureNotional: DecimalString;
  maxAccountExposureNotional: DecimalString;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
  maxDailyLoss: DecimalString;
  maxStrategyLoss: DecimalString;
  maxPriceDeviationPercent: DecimalString;
  maxMarketDataAgeMicros: number;
  tradingHalted: boolean;
  haltedReason: string | null;
  updatedAt: string;
}

export interface RiskEventView {
  id: string;
  tenantId: string;
  accountId: string | null;
  strategyId: string | null;
  orderId: string | null;
  eventType: RiskEventType;
  severity: RiskEventSeverity;
  code: string;
  message: string;
  limitValue: string | null;
  observedValue: string | null;
  venue: TradingVenue | null;
  symbol: string | null;
  correlationId: string | null;
  createdAt: string;
}

export interface KillSwitchView {
  id: string;
  tenantId: string | null;
  scope: KillSwitchScope;
  target: string | null;
  isEngaged: boolean;
  reason: string | null;
  engagedAt: string | null;
  releasedAt: string | null;
  updatedAt: string;
}

export interface TradingSessionView {
  id: string;
  tenantId: string;
  accountId: string | null;
  strategyId: string | null;
  status: TradingSessionStatus;
  tradingMode: TradingMode;
  workerId: string;
  startedAt: string;
  endedAt: string | null;
  heartbeatAt: string;
  signalsGenerated: number;
  ordersRequested: number;
  ordersSubmitted: number;
  ordersFilled: number;
  ordersRejected: number;
  riskRejections: number;
  bookResyncs: number;
  /** Observed measurements. The platform makes no latency guarantee. */
  medianDecisionLatencyMicros: number | null;
  p99DecisionLatencyMicros: number | null;
  stopReason: string | null;
}

/** Live top-of-book, served from Redis rather than PostgreSQL. */
export interface BookTopView {
  venue: TradingVenue;
  symbol: string;
  bestBid: DecimalString | null;
  bestBidQuantity: DecimalString | null;
  bestAsk: DecimalString | null;
  bestAskQuantity: DecimalString | null;
  midPrice: DecimalString | null;
  spread: DecimalString | null;
  spreadPercent: DecimalString | null;
  sequence: number;
  health: OrderBookHealth;
  exchangeTimestampMicros: string;
  receivedTimestampMicros: string;
}

/** Aggregate answer to "is this tenant trading, and is it safe?". */
export interface TradingStatusView {
  tenantId: string;
  /** Effective mode after every safeguard has been applied. */
  tradingMode: TradingMode;
  tradingEnabled: boolean;
  globalKillSwitchEngaged: boolean;
  engagedKillSwitches: KillSwitchView[];
  activeStrategies: number;
  enabledStrategies: number;
  openOrders: number;
  openPositions: number;
  connectedExchanges: number;
  degradedFeeds: string[];
  /** True when any open position was built from simulated fills. */
  hasSimulatedPositions: boolean;
  asOf: string;
}

// -----------------------------------------------------------------------------
// Write models accepted by the API
// -----------------------------------------------------------------------------

/**
 * Payload for connecting an exchange account.
 *
 * This is the only place an API secret is ever accepted, and only inbound: it
 * is encrypted immediately on receipt and never read back out. The API must
 * reject any key whose venue-reported permissions include withdrawal.
 */
export interface CreateTradingAccountRequest {
  exchangeId: string;
  label: string;
  marketType: TradingMarketType;
  isSandbox: boolean;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export interface UpdateTradingAccountRequest {
  label?: string;
  tradingMode?: TradingMode;
  status?: TradingAccountStatus.ACTIVE | TradingAccountStatus.DISABLED;
}

export interface UpsertRiskConfigurationRequest {
  maxOrderQuantity: DecimalString;
  maxOrderNotional: DecimalString;
  maxPositionQuantity: DecimalString;
  maxSymbolExposureNotional: DecimalString;
  maxAccountExposureNotional: DecimalString;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
  maxDailyLoss: DecimalString;
  maxStrategyLoss: DecimalString;
  maxPriceDeviationPercent: DecimalString;
  maxMarketDataAgeMicros: number;
  tradingHalted: boolean;
  haltedReason?: string;
}

export interface CreateStrategyRequest {
  name: string;
  kind: string;
  version: string;
  venue: TradingVenue;
  symbols: string[];
  marketType: TradingMarketType;
  accountId?: string;
  description?: string;
  maxOrderQuantity: DecimalString;
  maxPositionQuantity: DecimalString;
  maxOrderNotional: DecimalString;
  maxDailyLoss: DecimalString;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
}

export interface UpdateStrategyRequest {
  description?: string;
  accountId?: string;
  symbols?: string[];
  maxOrderQuantity?: DecimalString;
  maxPositionQuantity?: DecimalString;
  maxOrderNotional?: DecimalString;
  maxDailyLoss?: DecimalString;
  maxOpenOrders?: number;
  maxOrdersPerMinute?: number;
}

export interface SetStrategyEnabledRequest {
  enabled: boolean;
  reason?: string;
}

export interface CreateStrategyConfigurationRequest {
  parameters: Record<string, unknown>;
  changeNote?: string;
  activate: boolean;
}

/** Engaging or releasing one of the four kill switches. */
export interface SetKillSwitchRequest {
  scope: KillSwitchScope;
  /** Required for every scope except GLOBAL, which must omit it. */
  target?: string;
  engaged: boolean;
  reason: string;
}

// -----------------------------------------------------------------------------
// Realtime payloads
// -----------------------------------------------------------------------------

/** Envelope for every trading event pushed over the `/realtime` namespace. */
export interface TradingEventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  eventType: TradingEventType;
  tenantId: string | null;
  correlationId: string;
  causationId: string | null;
  source: string;
  occurredAtMicros: string;
  payload: T;
}

/** Socket.IO room names for trading subscriptions. */
export const TRADING_ROOMS = Object.freeze({
  tenantTrading: (tenantId: string): string => `tenant:${tenantId}:trading`,
  account: (tenantId: string, accountId: string): string =>
    `tenant:${tenantId}:account:${accountId}`,
  strategy: (tenantId: string, strategyId: string): string =>
    `tenant:${tenantId}:strategy:${strategyId}`,
  book: (venue: TradingVenue, symbol: string): string => `book:${venue}:${symbol}`,
});

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

/**
 * Trading permissions, added to the 54 defined in Part 1.
 *
 * Read and write are separated everywhere, and the four irreversible or
 * money-moving capabilities — connecting an account, enabling a strategy,
 * changing a risk limit and operating a kill switch — are distinct permissions
 * so they can be granted independently of ordinary read access.
 */
export enum TradingPermission {
  EXCHANGE_READ = 'trading:exchange:read',
  EXCHANGE_MANAGE = 'trading:exchange:manage',

  ACCOUNT_READ = 'trading:account:read',
  ACCOUNT_CONNECT = 'trading:account:connect',
  ACCOUNT_MANAGE = 'trading:account:manage',

  SYMBOL_READ = 'trading:symbol:read',
  SYMBOL_MANAGE = 'trading:symbol:manage',

  STRATEGY_READ = 'trading:strategy:read',
  STRATEGY_MANAGE = 'trading:strategy:manage',
  STRATEGY_TOGGLE = 'trading:strategy:toggle',

  RISK_READ = 'trading:risk:read',
  RISK_MANAGE = 'trading:risk:manage',

  ORDER_READ = 'trading:order:read',
  ORDER_CANCEL = 'trading:order:cancel',

  POSITION_READ = 'trading:position:read',

  SESSION_READ = 'trading:session:read',

  KILL_SWITCH_READ = 'trading:killswitch:read',
  KILL_SWITCH_OPERATE = 'trading:killswitch:operate',
}

export const TRADING_PERMISSIONS: readonly TradingPermission[] = Object.freeze(
  Object.values(TradingPermission),
);
