import { Injectable, Logger } from '@nestjs/common';
import { ExchangeVenue, ExchangeEnvironment, ExchangeCapability, ExchangeOrderType } from './exchange.types';

export interface ExchangeRegistryEntry {
  venue: ExchangeVenue;
  displayName: string;
  supportedEnvironments: ExchangeEnvironment[];
  supportedCapabilities: ExchangeCapability[];
  supportedOrderTypes: ExchangeOrderType[];
  apiVersion: string;
  restAvailable: boolean;
  websocketAvailable: boolean;
  symbolFormat: string; // e.g. BTCUSDT, BTC-USDT, BTC/USD
  rateLimitModel: string; // e.g. WEIGHT, REQUEST_COUNT, TOKEN_BUCKET
  authenticationModel: string; // e.g. HMAC_SHA256, API_KEY_SECRET_PASSPHRASE
  baseRestUrlLive: string;
  baseRestUrlTestnet: string;
  baseRestUrlSandbox: string;
  baseWsUrlLive: string;
  baseWsUrlTestnet: string;
  baseWsUrlSandbox: string;
  requiresPassphrase: boolean;
  supportsSubAccounts: boolean;
  withdrawalAllowed: boolean; // always false for trading keys per security policy
  documentationUrl: string;
  isActive: boolean;
  isOtherConfigured: boolean;
}

/**
 * Canonical registry of supported exchanges, capabilities, API versions, environments, symbols/features, and provider availability without storing credentials.
 * Do NOT store API secrets here. Do not hardcode account-specific credentials.
 */
@Injectable()
export class ExchangeRegistryService {
  private readonly logger = new Logger(ExchangeRegistryService.name);

  private readonly registry: Map<ExchangeVenue, ExchangeRegistryEntry> = new Map([
    [
      ExchangeVenue.BINANCE,
      {
        venue: ExchangeVenue.BINANCE,
        displayName: 'Binance',
        supportedEnvironments: [ExchangeVenue.BINANCE ? ExchangeEnvironment.LIVE : ExchangeEnvironment.LIVE, ExchangeEnvironment.TESTNET, ExchangeEnvironment.SANDBOX],
        supportedCapabilities: [
          ExchangeCapability.SPOT,
          ExchangeCapability.MARGIN,
          ExchangeCapability.FUTURES,
          ExchangeCapability.PERPETUALS,
          ExchangeCapability.MARKET_DATA,
          ExchangeCapability.BALANCES,
          ExchangeCapability.POSITIONS,
          ExchangeCapability.ORDERS,
          ExchangeCapability.TRADES,
          ExchangeCapability.WEBSOCKETS,
          ExchangeCapability.TESTNET,
        ],
        supportedOrderTypes: [
          ExchangeOrderType.MARKET,
          ExchangeOrderType.LIMIT,
          ExchangeOrderType.STOP,
          ExchangeOrderType.STOP_LIMIT,
          ExchangeOrderType.TAKE_PROFIT,
          ExchangeOrderType.TAKE_PROFIT_LIMIT,
          ExchangeOrderType.LIMIT_MAKER,
        ],
        apiVersion: 'v3',
        restAvailable: true,
        websocketAvailable: true,
        symbolFormat: 'BTCUSDT',
        rateLimitModel: 'WEIGHT',
        authenticationModel: 'HMAC_SHA256',
        baseRestUrlLive: 'https://api.binance.com',
        baseRestUrlTestnet: 'https://testnet.binance.vision',
        baseRestUrlSandbox: 'https://testnet.binance.vision',
        baseWsUrlLive: 'wss://stream.binance.com:9443',
        baseWsUrlTestnet: 'wss://testnet.binance.vision',
        baseWsUrlSandbox: 'wss://testnet.binance.vision',
        requiresPassphrase: false,
        supportsSubAccounts: true,
        withdrawalAllowed: false,
        documentationUrl: 'https://binance-docs.github.io/apidocs/',
        isActive: true,
        isOtherConfigured: false,
      },
    ],
    [
      ExchangeVenue.BYBIT,
      {
        venue: ExchangeVenue.BYBIT,
        displayName: 'Bybit',
        supportedEnvironments: [ExchangeEnvironment.LIVE, ExchangeEnvironment.TESTNET, ExchangeEnvironment.SANDBOX],
        supportedCapabilities: [
          ExchangeCapability.SPOT,
          ExchangeCapability.FUTURES,
          ExchangeCapability.PERPETUALS,
          ExchangeCapability.MARKET_DATA,
          ExchangeCapability.BALANCES,
          ExchangeCapability.POSITIONS,
          ExchangeCapability.ORDERS,
          ExchangeCapability.TRADES,
          ExchangeCapability.WEBSOCKETS,
          ExchangeCapability.TESTNET,
        ],
        supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.STOP, ExchangeOrderType.STOP_LIMIT],
        apiVersion: 'v5',
        restAvailable: true,
        websocketAvailable: true,
        symbolFormat: 'BTCUSDT',
        rateLimitModel: 'REQUEST_COUNT',
        authenticationModel: 'HMAC_SHA256',
        baseRestUrlLive: 'https://api.bybit.com',
        baseRestUrlTestnet: 'https://api-testnet.bybit.com',
        baseRestUrlSandbox: 'https://api-testnet.bybit.com',
        baseWsUrlLive: 'wss://stream.bybit.com',
        baseWsUrlTestnet: 'wss://stream-testnet.bybit.com',
        baseWsUrlSandbox: 'wss://stream-testnet.bybit.com',
        requiresPassphrase: false,
        supportsSubAccounts: true,
        withdrawalAllowed: false,
        documentationUrl: 'https://bybit-exchange.github.io/docs/',
        isActive: true,
        isOtherConfigured: false,
      },
    ],
    [
      ExchangeVenue.OKX,
      {
        venue: ExchangeVenue.OKX,
        displayName: 'OKX',
        supportedEnvironments: [ExchangeEnvironment.LIVE, ExchangeEnvironment.TESTNET, ExchangeEnvironment.SANDBOX],
        supportedCapabilities: [
          ExchangeCapability.SPOT,
          ExchangeCapability.MARGIN,
          ExchangeCapability.FUTURES,
          ExchangeCapability.PERPETUALS,
          ExchangeCapability.OPTIONS,
          ExchangeCapability.MARKET_DATA,
          ExchangeCapability.BALANCES,
          ExchangeCapability.POSITIONS,
          ExchangeCapability.ORDERS,
          ExchangeCapability.TRADES,
          ExchangeCapability.WEBSOCKETS,
          ExchangeCapability.TESTNET,
        ],
        supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.STOP, ExchangeOrderType.STOP_LIMIT],
        apiVersion: 'v5',
        restAvailable: true,
        websocketAvailable: true,
        symbolFormat: 'BTC-USDT',
        rateLimitModel: 'REQUEST_COUNT',
        authenticationModel: 'HMAC_SHA256_PASSPHRASE',
        baseRestUrlLive: 'https://www.okx.com',
        baseRestUrlTestnet: 'https://www.okx.com',
        baseRestUrlSandbox: 'https://www.okx.com',
        baseWsUrlLive: 'wss://ws.okx.com:8443/ws/v5/public',
        baseWsUrlTestnet: 'wss://wspap.okx.com:8443/ws/v5/public',
        baseWsUrlSandbox: 'wss://wspap.okx.com:8443/ws/v5/public',
        requiresPassphrase: true,
        supportsSubAccounts: true,
        withdrawalAllowed: false,
        documentationUrl: 'https://www.okx.com/docs-v5/en/',
        isActive: true,
        isOtherConfigured: false,
      },
    ],
    [
      ExchangeVenue.KRAKEN,
      {
        venue: ExchangeVenue.KRAKEN,
        displayName: 'Kraken',
        supportedEnvironments: [ExchangeEnvironment.LIVE, ExchangeEnvironment.SANDBOX],
        supportedCapabilities: [
          ExchangeCapability.SPOT,
          ExchangeCapability.MARGIN,
          ExchangeCapability.FUTURES,
          ExchangeCapability.MARKET_DATA,
          ExchangeCapability.BALANCES,
          ExchangeCapability.POSITIONS,
          ExchangeCapability.ORDERS,
          ExchangeCapability.TRADES,
          ExchangeCapability.WEBSOCKETS,
        ],
        supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.STOP, ExchangeOrderType.STOP_LIMIT, ExchangeOrderType.TAKE_PROFIT],
        apiVersion: 'v1',
        restAvailable: true,
        websocketAvailable: true,
        symbolFormat: 'XBT/USD',
        rateLimitModel: 'TOKEN_BUCKET',
        authenticationModel: 'HMAC_SHA512',
        baseRestUrlLive: 'https://api.kraken.com',
        baseRestUrlTestnet: 'https://api.kraken.com',
        baseRestUrlSandbox: 'https://api.kraken.com',
        baseWsUrlLive: 'wss://ws.kraken.com',
        baseWsUrlTestnet: 'wss://ws.kraken.com',
        baseWsUrlSandbox: 'wss://ws.kraken.com',
        requiresPassphrase: false,
        supportsSubAccounts: false,
        withdrawalAllowed: false,
        documentationUrl: 'https://docs.kraken.com/rest/',
        isActive: true,
        isOtherConfigured: false,
      },
    ],
    [
      ExchangeVenue.COINBASE,
      {
        venue: ExchangeVenue.COINBASE,
        displayName: 'Coinbase Advanced Trade',
        supportedEnvironments: [ExchangeEnvironment.LIVE, ExchangeEnvironment.SANDBOX],
        supportedCapabilities: [
          ExchangeCapability.SPOT,
          ExchangeCapability.MARKET_DATA,
          ExchangeCapability.BALANCES,
          ExchangeCapability.ORDERS,
          ExchangeCapability.TRADES,
          ExchangeCapability.WEBSOCKETS,
        ],
        supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.STOP, ExchangeOrderType.STOP_LIMIT],
        apiVersion: 'v1',
        restAvailable: true,
        websocketAvailable: true,
        symbolFormat: 'BTC-USD',
        rateLimitModel: 'REQUEST_COUNT',
        authenticationModel: 'HMAC_SHA256_PASSPHRASE',
        baseRestUrlLive: 'https://api.coinbase.com',
        baseRestUrlTestnet: 'https://api-public.sandbox.exchange.coinbase.com',
        baseRestUrlSandbox: 'https://api-public.sandbox.exchange.coinbase.com',
        baseWsUrlLive: 'wss://advanced-trade-ws.coinbase.com',
        baseWsUrlTestnet: 'wss://advanced-trade-ws-sandbox.coinbase.com',
        baseWsUrlSandbox: 'wss://advanced-trade-ws-sandbox.coinbase.com',
        requiresPassphrase: true,
        supportsSubAccounts: false,
        withdrawalAllowed: false,
        documentationUrl: 'https://docs.cloud.coinbase.com/advanced-trade/',
        isActive: true,
        isOtherConfigured: false,
      },
    ],
    [
      ExchangeVenue.OTHER_CONFIGURED,
      {
        venue: ExchangeVenue.OTHER_CONFIGURED,
        displayName: 'Other Configured Exchange',
        supportedEnvironments: [ExchangeEnvironment.LIVE, ExchangeEnvironment.TESTNET, ExchangeEnvironment.SANDBOX],
        supportedCapabilities: [
          ExchangeCapability.MARKET_DATA,
          ExchangeCapability.BALANCES,
          ExchangeCapability.ORDERS,
          ExchangeCapability.TESTNET,
        ],
        supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT],
        apiVersion: 'v1',
        restAvailable: true,
        websocketAvailable: false,
        symbolFormat: 'BTCUSDT',
        rateLimitModel: 'REQUEST_COUNT',
        authenticationModel: 'HMAC_SHA256',
        baseRestUrlLive: 'https://api.other-configured.com',
        baseRestUrlTestnet: 'https://testnet.other-configured.com',
        baseRestUrlSandbox: 'https://sandbox.other-configured.com',
        baseWsUrlLive: 'wss://ws.other-configured.com',
        baseWsUrlTestnet: 'wss://testnet-ws.other-configured.com',
        baseWsUrlSandbox: 'wss://sandbox-ws.other-configured.com',
        requiresPassphrase: false,
        supportsSubAccounts: false,
        withdrawalAllowed: false,
        documentationUrl: 'https://other-configured.com/docs',
        isActive: false,
        isOtherConfigured: true,
      },
    ],
  ]);

  getAllVenues(): ExchangeRegistryEntry[] {
    return Array.from(this.registry.values());
  }

  getActiveVenues(): ExchangeRegistryEntry[] {
    return Array.from(this.registry.values()).filter((e) => e.isActive);
  }

  getVenue(venue: ExchangeVenue): ExchangeRegistryEntry | null {
    return this.registry.get(venue) || null;
  }

  isVenueSupported(venue: ExchangeVenue): boolean {
    const entry = this.registry.get(venue);
    return !!entry && entry.isActive;
  }

  isEnvironmentSupported(venue: ExchangeVenue, environment: ExchangeEnvironment): boolean {
    const entry = this.registry.get(venue);
    if (!entry) return false;
    return entry.supportedEnvironments.includes(environment);
  }

  isCapabilitySupported(venue: ExchangeVenue, capability: ExchangeCapability): boolean {
    const entry = this.registry.get(venue);
    if (!entry) return false;
    return entry.supportedCapabilities.includes(capability);
  }

  getRestBaseUrl(venue: ExchangeVenue, environment: ExchangeEnvironment): string {
    const entry = this.registry.get(venue);
    if (!entry) throw new Error(`Unknown venue ${venue}`);
    switch (environment) {
      case ExchangeEnvironment.LIVE:
        return entry.baseRestUrlLive;
      case ExchangeEnvironment.TESTNET:
        return entry.baseRestUrlTestnet;
      case ExchangeEnvironment.SANDBOX:
        return entry.baseRestUrlSandbox;
      default:
        return entry.baseRestUrlLive;
    }
  }

  getWsBaseUrl(venue: ExchangeVenue, environment: ExchangeEnvironment): string {
    const entry = this.registry.get(venue);
    if (!entry) throw new Error(`Unknown venue ${venue}`);
    switch (environment) {
      case ExchangeEnvironment.LIVE:
        return entry.baseWsUrlLive;
      case ExchangeEnvironment.TESTNET:
        return entry.baseWsUrlTestnet;
      case ExchangeEnvironment.SANDBOX:
        return entry.baseWsUrlSandbox;
      default:
        return entry.baseWsUrlLive;
    }
  }

  validateEnvironmentBinding(venue: ExchangeVenue, environment: ExchangeEnvironment, isSandbox: boolean): boolean {
    // SANDBOX/TESTNET must have isSandbox true, LIVE must have isSandbox false
    if (environment === ExchangeEnvironment.LIVE && isSandbox) {
      return false;
    }
    if ((environment === ExchangeEnvironment.SANDBOX || environment === ExchangeEnvironment.TESTNET) && !isSandbox) {
      // For backward compatibility, TESTNET may have isSandbox false in some legacy data, but we enforce strict separation now
      // For Part 13, we require isSandbox=true for non-LIVE
      return false;
    }
    return this.isEnvironmentSupported(venue, environment);
  }

  listCapabilities(venue: ExchangeVenue): ExchangeCapability[] {
    const entry = this.registry.get(venue);
    return entry ? entry.supportedCapabilities : [];
  }

  getDisplayName(venue: ExchangeVenue): string {
    const entry = this.registry.get(venue);
    return entry ? entry.displayName : venue;
  }
}
