/**
 * Provider-neutral exchange contract for authentication test, metadata, balances, positions, orders, market data, capabilities, account sync, and optional trading operations.
 * Each method must clearly distinguish: read-only, simulated/testnet, live. Never allow generic interface to bypass existing live gate.
 */

import {
  ExchangeVenue,
  ExchangeEnvironment,
  ExchangeCapability,
  ExchangeConnectivityResult,
  ExchangeBalance,
  ExchangePosition,
  ExchangeOrder,
  ExchangeFill,
  ExchangeSymbol,
  ExchangeCapabilityDiscovery,
} from './exchange.types';

export enum ExchangeProviderErrorCode {
  AUTH_FAILED = 'AUTH_FAILED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RATE_LIMITED = 'RATE_LIMITED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  SERVER_ERROR = 'SERVER_ERROR',
  SYMBOL_NOT_FOUND = 'SYMBOL_NOT_FOUND',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_ORDER = 'INVALID_ORDER',
  ENVIRONMENT_MISMATCH = 'ENVIRONMENT_MISMATCH',
  WITHDRAWAL_NOT_ALLOWED = 'WITHDRAWAL_NOT_ALLOWED',
  CLOCK_DRIFT = 'CLOCK_DRIFT',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  NOT_SUPPORTED = 'NOT_SUPPORTED',
  UNKNOWN = 'UNKNOWN',
}

export class ExchangeProviderError extends Error {
  constructor(
    public readonly code: ExchangeProviderErrorCode,
    message: string,
    public readonly venue: ExchangeVenue,
    public readonly environment: ExchangeEnvironment,
    public readonly isRetryable: boolean = false,
    public readonly retryAfterMs: number | null = null,
    public readonly originalError?: any,
  ) {
    super(message);
    this.name = 'ExchangeProviderError';
  }

  toSafeObject(): Record<string, any> {
    return {
      code: this.code,
      message: this.message,
      venue: this.venue,
      environment: this.environment,
      isRetryable: this.isRetryable,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  environment: ExchangeEnvironment;
  isSandbox: boolean;
}

export interface ExchangeProviderContext {
  tenantId: string;
  accountId: string;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  isSandbox: boolean;
  credentials: ExchangeCredentials;
  credentialRef: string | null;
  ipAllowlist?: string[];
}

export interface ExchangeServerTime {
  serverTimeMicros: string;
  localTimeMicros: string;
  driftMs: number;
}

export interface ExchangeAccountMetadata {
  accountId: string;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  isSandbox: boolean;
  canTrade: boolean;
  canRead: boolean;
  canWithdraw: boolean;
  ipRestricted: boolean;
  permissions: string[];
  uid: string | null;
  email: string | null;
}

export interface ExchangeProvider {
  readonly venue: ExchangeVenue;
  readonly displayName: string;
  readonly supportedEnvironments: ExchangeEnvironment[];
  readonly supportedCapabilities: ExchangeCapability[];

  /**
   * Read-only connectivity check - never places orders.
   * Validates credential validity, reachability, server time, clock drift, account identity, basic permissions.
   */
  testConnectivity(context: ExchangeProviderContext): Promise<ExchangeConnectivityResult>;

  /**
   * Read-only server time for clock drift detection.
   */
  getServerTime(context: ExchangeProviderContext): Promise<ExchangeServerTime>;

  /**
   * Read-only account metadata.
   */
  getAccountMetadata(context: ExchangeProviderContext): Promise<ExchangeAccountMetadata>;

  /**
   * Read-only capability discovery - authoritative and provider-specific.
   */
  getCapabilities(context: ExchangeProviderContext): Promise<ExchangeCapabilityDiscovery>;

  /**
   * Read-only balances - Decimal-safe strings.
   */
  getBalances(context: ExchangeProviderContext): Promise<ExchangeBalance[]>;

  /**
   * Read-only positions.
   */
  getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]>;

  /**
   * Read-only open orders.
   */
  getOpenOrders(context: ExchangeProviderContext, symbol?: string): Promise<ExchangeOrder[]>;

  /**
   * Read-only order history.
   */
  getOrderHistory(context: ExchangeProviderContext, symbol?: string, limit?: number): Promise<ExchangeOrder[]>;

  /**
   * Read-only trade/fill history.
   */
  getTradeHistory(context: ExchangeProviderContext, symbol?: string, limit?: number): Promise<ExchangeFill[]>;

  /**
   * Read-only symbol information - authoritative from exchange.
   */
  getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]>;

  /**
   * Optional: create order - must be gated by existing live enablement outside this interface.
   * This method itself must NOT bypass live gate; caller must verify gate before invoking.
   * Simulated/testnet vs live must be explicit.
   */
  createOrder?(
    context: ExchangeProviderContext,
    order: {
      symbol: string;
      side: string;
      type: string;
      quantity: string;
      price?: string;
      stopPrice?: string;
      clientOrderId: string;
      isSimulated: boolean;
    },
  ): Promise<ExchangeOrder>;

  /**
   * Optional: cancel order - same live-gate requirement.
   */
  cancelOrder?(context: ExchangeProviderContext, orderId: string, symbol?: string): Promise<ExchangeOrder>;

  /**
   * Validates environment binding - LIVE credential must never be used against testnet URL and vice versa.
   * Must fail closed on mismatch.
   */
  validateEnvironmentBinding(environment: ExchangeEnvironment, isSandbox: boolean): boolean;

  /**
   * Returns safe REST base URL for given environment without exposing secrets.
   */
  getRestBaseUrl(environment: ExchangeEnvironment): string;

  /**
   * Returns safe WebSocket base URL for given environment without exposing secrets.
   */
  getWebsocketBaseUrl(environment: ExchangeEnvironment): string;
}

export interface ExchangeProviderConstructor {
  new (): ExchangeProvider;
}
