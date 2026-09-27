/**
 * Canonical exchange domain types: venue, environment, connection state, capabilities, account state, symbols, balances, positions, orders, health, sync state, and safe references.
 * Never expose credentials inside domain types.
 */

export enum ExchangeVenue {
  BINANCE = 'BINANCE',
  BYBIT = 'BYBIT',
  OKX = 'OKX',
  KRAKEN = 'KRAKEN',
  COINBASE = 'COINBASE',
  OTHER_CONFIGURED = 'OTHER_CONFIGURED',
}

export enum ExchangeEnvironment {
  SANDBOX = 'SANDBOX',
  TESTNET = 'TESTNET',
  LIVE = 'LIVE',
}

export enum ExchangeConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DEGRADED = 'DEGRADED',
  FAILED = 'FAILED',
  REVOKED = 'REVOKED',
}

export enum ExchangeAccountState {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  REVOKED = 'REVOKED',
  ERROR = 'ERROR',
}

export enum ExchangeCapability {
  SPOT = 'SPOT',
  MARGIN = 'MARGIN',
  FUTURES = 'FUTURES',
  PERPETUALS = 'PERPETUALS',
  OPTIONS = 'OPTIONS',
  MARKET_DATA = 'MARKET_DATA',
  BALANCES = 'BALANCES',
  POSITIONS = 'POSITIONS',
  ORDERS = 'ORDERS',
  TRADES = 'TRADES',
  WEBSOCKETS = 'WEBSOCKETS',
  TESTNET = 'TESTNET',
  WITHDRAWALS = 'WITHDRAWALS',
}

export enum ExchangeHealthState {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNAVAILABLE = 'UNAVAILABLE',
  AUTH_FAILED = 'AUTH_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  STALE = 'STALE',
}

export enum ExchangeSyncState {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  STALE = 'STALE',
}

export enum ExchangeOrderStatus {
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELED = 'CANCELED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  PENDING_CANCEL = 'PENDING_CANCEL',
}

export enum ExchangeOrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum ExchangeOrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
  TAKE_PROFIT = 'TAKE_PROFIT',
  TAKE_PROFIT_LIMIT = 'TAKE_PROFIT_LIMIT',
  LIMIT_MAKER = 'LIMIT_MAKER',
}

export enum ExchangePositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
  BOTH = 'BOTH',
  FLAT = 'FLAT',
}

export interface ExchangeSafeReference {
  accountId: string;
  tenantId: string;
  userId: string | null;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  label: string;
  maskedApiKey: string; // last 4 chars only, e.g. ****ABCD
  status: ExchangeAccountState;
  connectionState: ExchangeConnectionState;
  healthState: ExchangeHealthState;
  capabilities: ExchangeCapability[];
  isSandbox: boolean;
  liveTradingEnabled: boolean;
  credentialRef: string | null;
  credentialSource: string;
  lastVerifiedAt: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeBalance {
  asset: string;
  free: string; // Decimal-safe string
  locked: string; // Decimal-safe string
  total: string; // Decimal-safe string
  providerReference: string | null;
  timestampMicros: string; // epoch micros as string
  source: string; // e.g. REST, WEBSOCKET, RECONCILIATION
  isSimulated: boolean;
}

export interface ExchangePosition {
  providerPositionId: string | null;
  symbol: string; // canonical e.g. BTC-USDT
  exchangeSymbol: string; // venue specific e.g. BTCUSDT
  side: ExchangePositionSide;
  quantity: string; // Decimal-safe
  entryPrice: string | null;
  markPrice: string | null;
  liquidationPrice: string | null;
  leverage: string | null;
  unrealizedPnl: string | null;
  realizedPnl: string | null;
  timestampMicros: string;
  isSimulated: boolean;
}

export interface ExchangeOrder {
  clientOrderId: string;
  providerOrderId: string | null;
  symbol: string;
  exchangeSymbol: string;
  side: ExchangeOrderSide;
  type: ExchangeOrderType;
  status: ExchangeOrderStatus;
  providerRawStatus: string | null; // safe raw status for audit
  quantity: string;
  price: string | null;
  stopPrice: string | null;
  filledQuantity: string;
  averagePrice: string | null;
  fee: string | null;
  feeCurrency: string | null;
  createdAtMicros: string | null;
  updatedAtMicros: string | null;
  isSimulated: boolean;
}

export interface ExchangeFill {
  providerTradeId: string;
  providerOrderId: string | null;
  clientOrderId: string | null;
  symbol: string;
  side: ExchangeOrderSide;
  price: string;
  quantity: string;
  quoteQuantity: string | null;
  fee: string | null;
  feeCurrency: string | null;
  isMaker: boolean | null;
  timestampMicros: string;
  isSimulated: boolean;
}

export interface ExchangeSymbol {
  canonicalSymbol: string; // e.g. BTC-USDT
  exchangeSymbol: string; // e.g. BTCUSDT
  baseAsset: string;
  quoteAsset: string;
  contractType: string | null; // SPOT, PERPETUAL, FUTURE, OPTION
  tickSize: string; // Decimal string
  quantityStep: string;
  minQuantity: string | null;
  maxQuantity: string | null;
  minNotional: string | null;
  maxNotional: string | null;
  pricePrecision: number;
  quantityPrecision: number;
  minLeverage: number | null;
  maxLeverage: number | null;
  isTradeable: boolean;
}

export interface ExchangeConnectivityResult {
  connected: boolean;
  degraded: boolean;
  state: ExchangeConnectionState;
  latencyMs: number;
  serverTimeMicros: string | null;
  clockDriftMs: number | null;
  capabilities: ExchangeCapability[];
  failureCode: string | null;
  failureReason: string | null;
  isSimulated: boolean;
  environment: ExchangeEnvironment;
}

export interface ExchangeHealth {
  accountId: string;
  tenantId: string;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  state: ExchangeHealthState;
  latencyMs: number | null;
  authFailures: number;
  apiErrors: number;
  rateLimitPressure: number; // 0-100
  syncAgeMs: number | null;
  clockDriftMs: number | null;
  websocketConnected: boolean | null;
  providerAvailable: boolean;
  credentialExpired: boolean;
  credentialRevoked: boolean;
  lastCheckedAt: string;
  lastErrorCode: string | null;
  message: string | null;
}

export interface ExchangeRateLimit {
  venue: ExchangeVenue;
  endpointClass: string; // e.g. PUBLIC, PRIVATE, ORDER, MARKET_DATA
  requestsPerInterval: number;
  intervalMs: number;
  weightPerRequest: number;
  remaining: number | null;
  resetAtMs: number | null;
  retryAfterMs: number | null;
  isWeightBased: boolean;
  scope: string; // ACCOUNT, IP, GLOBAL
}

export interface ExchangeRoutingDecision {
  selectedAccountId: string | null;
  selectedVenue: ExchangeVenue | null;
  environment: ExchangeEnvironment | null;
  eligibleAccounts: string[];
  routingReason: string;
  capabilities: ExchangeCapability[];
  health: ExchangeHealthState | null;
  liveExecutionPermitted: boolean;
  liveGateBlockingReasons: string[];
  complianceAllowed: boolean;
  riskAllowed: boolean;
}

export interface ExchangeCapabilityDiscovery {
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  capabilities: ExchangeCapability[];
  supportedOrderTypes: ExchangeOrderType[];
  supportedEnvironments: ExchangeEnvironment[];
  apiVersion: string;
  restAvailable: boolean;
  websocketAvailable: boolean;
  rateLimitModel: string;
  authenticationModel: string;
  symbolFormat: string;
  timestamp: string;
}

export interface ExchangeSyncResult {
  accountId: string;
  tenantId: string;
  syncType: 'BALANCE' | 'POSITION' | 'ORDER' | 'FILL';
  state: ExchangeSyncState;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  lastSyncAt: string;
  durationMs: number;
  errorCode: string | null;
  isSimulated: boolean;
}

export const FORBIDDEN_CREDENTIAL_FIELDS = [
  'apiKey',
  'apiSecret',
  'secret',
  'passphrase',
  'privateKey',
  'withdrawal',
  'token',
  'credential',
] as const;

export function sanitizeExchangeMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_CREDENTIAL_FIELDS.some((f) => lowerKey.includes(f.toLowerCase()))) {
      continue;
    }
    if (typeof value === 'string' && value.length > 500) {
      sanitized[key] = value.substring(0, 500);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeExchangeMetadata(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 4) return '****';
  return `****${apiKey.slice(-4)}`;
}

export function normalizeTimestampMicros(input: number | string | Date): string {
  let micros: bigint;
  if (typeof input === 'number') {
    // Assume milliseconds if < 1e12, micros if larger
    if (input < 1e12) {
      micros = BigInt(Math.floor(input * 1000));
    } else if (input < 1e15) {
      micros = BigInt(Math.floor(input * 1000)); // still ms
    } else {
      micros = BigInt(input);
    }
  } else if (typeof input === 'string') {
    // Try to parse as decimal string, preserve
    if (/^\d+$/.test(input)) {
      // numeric string
      const num = Number(input);
      if (num < 1e12) {
        micros = BigInt(Math.floor(num * 1000));
      } else if (num < 1e15) {
        micros = BigInt(num * 1000);
      } else {
        micros = BigInt(input);
      }
    } else {
      const date = new Date(input);
      micros = BigInt(date.getTime() * 1000);
    }
  } else {
    micros = BigInt(input.getTime() * 1000);
  }
  return micros.toString();
}

export function isValidOrderStatusTransition(from: ExchangeOrderStatus, to: ExchangeOrderStatus): boolean {
  const allowed: Record<ExchangeOrderStatus, ExchangeOrderStatus[]> = {
    [ExchangeOrderStatus.NEW]: [
      ExchangeOrderStatus.PARTIALLY_FILLED,
      ExchangeOrderStatus.FILLED,
      ExchangeOrderStatus.CANCELED,
      ExchangeOrderStatus.REJECTED,
      ExchangeOrderStatus.EXPIRED,
      ExchangeOrderStatus.PENDING_CANCEL,
    ],
    [ExchangeOrderStatus.PARTIALLY_FILLED]: [
      ExchangeOrderStatus.PARTIALLY_FILLED,
      ExchangeOrderStatus.FILLED,
      ExchangeOrderStatus.CANCELED,
      ExchangeOrderStatus.PENDING_CANCEL,
    ],
    [ExchangeOrderStatus.PENDING_CANCEL]: [ExchangeOrderStatus.CANCELED, ExchangeOrderStatus.PARTIALLY_FILLED, ExchangeOrderStatus.FILLED],
    [ExchangeOrderStatus.FILLED]: [],
    [ExchangeOrderStatus.CANCELED]: [],
    [ExchangeOrderStatus.REJECTED]: [],
    [ExchangeOrderStatus.EXPIRED]: [],
  };
  if (from === to) return true;
  return allowed[from]?.includes(to) ?? false;
}
