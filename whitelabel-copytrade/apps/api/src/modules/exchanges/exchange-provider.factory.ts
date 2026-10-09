// # Selects live vs paper mode based on explicit safety flags
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ExchangeVenue, ExchangeEnvironment, ExchangeCapability, ExchangeOrderType, ExchangeConnectionState, ExchangeBalance, ExchangePosition, ExchangeOrder, ExchangeFill, ExchangeSymbol, ExchangeCapabilityDiscovery, ExchangePositionSide, ExchangeOrderStatus, ExchangeOrderSide, normalizeTimestampMicros } from './exchange.types';
import { ExchangeProvider, ExchangeProviderError, ExchangeProviderErrorCode, ExchangeProviderContext, ExchangeServerTime, ExchangeAccountMetadata } from './exchange-provider.interface';
import { ExchangeRegistryService } from './exchange-registry.service';
import {
  BaseExchangeProvider,
  addDecimalStrings,
  absDecimalString,
  signOfDecimalString,
  isDecimalString,
  canonicalFromConcatenated,
} from './base-exchange-provider';
import { BybitProvider } from './providers/bybit.provider';
import { OkxProvider } from './providers/okx.provider';
import { KrakenProvider } from './providers/kraken.provider';
import { CoinbaseProvider } from './providers/coinbase.provider';
import * as crypto from 'crypto';


// ---------------------------------------------------------------------------
// Binance adapter - real implementation, no fake data
// ---------------------------------------------------------------------------

class BinanceProvider extends BaseExchangeProvider {
  readonly venue = ExchangeVenue.BINANCE;
  readonly displayName = 'Binance';
  readonly supportedEnvironments = [ExchangeEnvironment.LIVE, ExchangeEnvironment.TESTNET, ExchangeEnvironment.SANDBOX];
  readonly supportedCapabilities = [
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
  ];

  protected getLiveRestUrl(): string {
    return 'https://api.binance.com';
  }
  protected getTestnetRestUrl(): string {
    return 'https://testnet.binance.vision';
  }
  protected getSandboxRestUrl(): string {
    return 'https://testnet.binance.vision';
  }
  protected getLiveWsUrl(): string {
    return 'wss://stream.binance.com:9443';
  }
  protected getTestnetWsUrl(): string {
    return 'wss://testnet.binance.vision';
  }
  protected getSandboxWsUrl(): string {
    return 'wss://testnet.binance.vision';
  }

  private sign(query: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(query).digest('hex');
  }

  async getServerTime(context: ExchangeProviderContext): Promise<ExchangeServerTime> {
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/api/v3/time`;
    const start = Date.now();
    try {
      const data = await this.httpGet(url);
      const serverTimeMs = data.serverTime;
      const localMs = Date.now();
      const drift = localMs - serverTimeMs;
      return {
        serverTimeMicros: (BigInt(serverTimeMs) * BigInt(1000)).toString(),
        localTimeMicros: (BigInt(localMs) * BigInt(1000)).toString(),
        driftMs: drift,
      };
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async testConnectivity(context: ExchangeProviderContext): Promise<any> {
    // Server time + /api/v3/account through the shared proof: a key that can
    // withdraw is refused, a read-only key connects DEGRADED (it syncs but the
    // venue will refuse orders), and every venue error is classified.
    return this.connectivityFromMetadata(context);
  }

  async getAccountMetadata(context: ExchangeProviderContext): Promise<ExchangeAccountMetadata> {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = this.sign(query, context.credentials.apiSecret);
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/api/v3/account?${query}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': context.credentials.apiKey };
    try {
      const data = await this.httpGet(url, headers);
      return {
        accountId: context.accountId,
        venue: context.venue,
        environment: context.environment,
        isSandbox: context.isSandbox,
        canTrade: data.canTrade === true,
        canRead: true,
        // Absent or malformed flag counts as "can withdraw" - fail closed.
        canWithdraw: data.canWithdraw !== false,
        ipRestricted: false,
        permissions: data.permissions || [],
        uid: null,
        email: null,
      };
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async getCapabilities(context: ExchangeProviderContext): Promise<ExchangeCapabilityDiscovery> {
    return {
      venue: context.venue,
      environment: context.environment,
      capabilities: this.supportedCapabilities,
      supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.STOP, ExchangeOrderType.STOP_LIMIT, ExchangeOrderType.TAKE_PROFIT, ExchangeOrderType.TAKE_PROFIT_LIMIT, ExchangeOrderType.LIMIT_MAKER],
      supportedEnvironments: this.supportedEnvironments,
      apiVersion: 'v3',
      restAvailable: true,
      websocketAvailable: true,
      rateLimitModel: 'WEIGHT',
      authenticationModel: 'HMAC_SHA256',
      symbolFormat: 'BTCUSDT',
      timestamp: new Date().toISOString(),
    };
  }

  async getBalances(context: ExchangeProviderContext): Promise<ExchangeBalance[]> {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = this.sign(query, context.credentials.apiSecret);
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/api/v3/account?${query}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': context.credentials.apiKey };
    try {
      const data = await this.httpGet(url, headers);
      const balances = data.balances || [];
      return balances
        .filter((b: any) => isDecimalString(b.free) && isDecimalString(b.locked))
        .filter((b: any) => signOfDecimalString(b.free) > 0 || signOfDecimalString(b.locked) > 0)
        .map((b: any) => ({
          asset: b.asset,
          free: b.free, // preserve string precision
          locked: b.locked,
          total: addDecimalStrings(b.free, b.locked), // exact decimal-string addition, no float rounding
          providerReference: null,
          timestampMicros: (BigInt(Date.now()) * BigInt(1000)).toString(),
          source: 'REST',
          isSimulated: context.isSandbox,
        }));
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  /** USD-M futures are served from their own host, never from the spot REST base. */
  private futuresBaseUrl(environment: ExchangeEnvironment): string {
    return environment === ExchangeEnvironment.LIVE ? 'https://fapi.binance.com' : 'https://testnet.binancefuture.com';
  }

  async getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]> {
    // Binance spot has no positions; USD-M futures does. A key without futures
    // enabled is answered 401/403 (-2015) by the futures host - that is the
    // truthful "no futures positions" case. Every other failure (network,
    // rate limit, 5xx, clock) is surfaced instead of being reported as flat.
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = this.sign(query, context.credentials.apiSecret);
    const url = `${this.futuresBaseUrl(context.environment)}/fapi/v2/positionRisk?${query}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': context.credentials.apiKey };
    let data: any;
    try {
      data = await this.httpGet(url, headers);
    } catch (e: any) {
      if (e?.status === 401 || e?.status === 403 || e?.data?.code === -2015) return [];
      throw this.normalizeError(e, context.venue, context.environment);
    }
    if (!Array.isArray(data)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, 'Binance positionRisk returned a non-array body', context.venue, context.environment, true);
    }
    return data
      .filter((p: any) => isDecimalString(p.positionAmt) && signOfDecimalString(p.positionAmt) !== 0)
      .map((p: any) => ({
        providerPositionId: null,
        symbol: canonicalFromConcatenated(p.symbol),
        exchangeSymbol: p.symbol,
        side: signOfDecimalString(p.positionAmt) > 0 ? ExchangePositionSide.LONG : ExchangePositionSide.SHORT,
        quantity: absDecimalString(p.positionAmt),
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        liquidationPrice: p.liquidationPrice,
        leverage: p.leverage,
        unrealizedPnl: p.unRealizedProfit,
        realizedPnl: null,
        timestampMicros: (BigInt(Date.now()) * BigInt(1000)).toString(),
        isSimulated: context.isSandbox,
      }));
  }

  async getOpenOrders(context: ExchangeProviderContext, symbol?: string): Promise<ExchangeOrder[]> {
    const timestamp = Date.now();
    let query = `timestamp=${timestamp}`;
    if (symbol) {
      const exchSym = symbol.replace('-', '');
      query += `&symbol=${exchSym}`;
    }
    const signature = this.sign(query, context.credentials.apiSecret);
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/api/v3/openOrders?${query}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': context.credentials.apiKey };
    try {
      const data = await this.httpGet(url, headers);
      const orders = Array.isArray(data) ? data : [data];
      return orders.map((o: any) => ({
        clientOrderId: o.clientOrderId,
        providerOrderId: o.orderId?.toString() || null,
        symbol: canonicalFromConcatenated(o.symbol),
        exchangeSymbol: o.symbol,
        side: o.side,
        type: o.type,
        status: this.mapOrderStatus(o.status),
        providerRawStatus: o.status,
        quantity: o.origQty,
        price: o.price,
        stopPrice: o.stopPrice || null,
        filledQuantity: o.executedQty,
        averagePrice: null,
        fee: null,
        feeCurrency: null,
        createdAtMicros: o.time ? (BigInt(o.time) * BigInt(1000)).toString() : null,
        updatedAtMicros: o.updateTime ? (BigInt(o.updateTime) * BigInt(1000)).toString() : null,
        isSimulated: context.isSandbox,
      }));
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async getOrderHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeOrder[]> {
    const timestamp = Date.now();
    let query = `timestamp=${timestamp}&limit=${limit}`;
    if (symbol) {
      const exchSym = symbol.replace('-', '');
      query += `&symbol=${exchSym}`;
    }
    const signature = this.sign(query, context.credentials.apiSecret);
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/api/v3/allOrders?${query}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': context.credentials.apiKey };
    try {
      const data = await this.httpGet(url, headers);
      const orders = Array.isArray(data) ? data : [];
      return orders.map((o: any) => ({
        clientOrderId: o.clientOrderId,
        providerOrderId: o.orderId?.toString() || null,
        symbol: canonicalFromConcatenated(o.symbol),
        exchangeSymbol: o.symbol,
        side: o.side,
        type: o.type,
        status: this.mapOrderStatus(o.status),
        providerRawStatus: o.status,
        quantity: o.origQty,
        price: o.price,
        stopPrice: o.stopPrice || null,
        filledQuantity: o.executedQty,
        averagePrice: null,
        fee: null,
        feeCurrency: null,
        createdAtMicros: o.time ? (BigInt(o.time) * BigInt(1000)).toString() : null,
        updatedAtMicros: o.updateTime ? (BigInt(o.updateTime) * BigInt(1000)).toString() : null,
        isSimulated: context.isSandbox,
      }));
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async getTradeHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeFill[]> {
    const timestamp = Date.now();
    let query = `timestamp=${timestamp}&limit=${limit}`;
    if (symbol) {
      const exchSym = symbol.replace('-', '');
      query += `&symbol=${exchSym}`;
    }
    const signature = this.sign(query, context.credentials.apiSecret);
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/api/v3/myTrades?${query}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': context.credentials.apiKey };
    try {
      const data = await this.httpGet(url, headers);
      const trades = Array.isArray(data) ? data : [];
      return trades.map((t: any) => ({
        providerTradeId: t.id?.toString(),
        providerOrderId: t.orderId?.toString() || null,
        clientOrderId: null,
        symbol: canonicalFromConcatenated(t.symbol),
        side: t.isBuyer ? ExchangeOrderSide.BUY : ExchangeOrderSide.SELL,
        price: t.price,
        quantity: t.qty,
        quoteQuantity: t.quoteQty,
        fee: t.commission,
        feeCurrency: t.commissionAsset,
        isMaker: t.isMaker,
        timestampMicros: t.time ? (BigInt(t.time) * BigInt(1000)).toString() : (BigInt(Date.now()) * BigInt(1000)).toString(),
        isSimulated: context.isSandbox,
      }));
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]> {
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/api/v3/exchangeInfo`;
    try {
      const data = await this.httpGet(url);
      const symbols = data.symbols || [];
      return symbols
        .filter((s: any) => s.status === 'TRADING')
        .map((s: any) => {
          const lotFilter = s.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
          const priceFilter = s.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
          const notionalFilter = s.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL');
          return {
            canonicalSymbol: `${s.baseAsset}-${s.quoteAsset}`,
            exchangeSymbol: s.symbol,
            baseAsset: s.baseAsset,
            quoteAsset: s.quoteAsset,
            contractType: 'SPOT',
            tickSize: priceFilter?.tickSize || '0.00000001',
            quantityStep: lotFilter?.stepSize || '0.00000001',
            minQuantity: lotFilter?.minQty || null,
            maxQuantity: lotFilter?.maxQty || null,
            minNotional: notionalFilter?.minNotional || null,
            maxNotional: null,
            pricePrecision: s.quotePrecision || 8,
            quantityPrecision: s.baseAssetPrecision || 8,
            minLeverage: null,
            maxLeverage: null,
            isTradeable: true,
          };
        });
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  private mapOrderStatus(status: string): ExchangeOrderStatus {
    const map: Record<string, ExchangeOrderStatus> = {
      NEW: ExchangeOrderStatus.NEW,
      PARTIALLY_FILLED: ExchangeOrderStatus.PARTIALLY_FILLED,
      FILLED: ExchangeOrderStatus.FILLED,
      CANCELED: ExchangeOrderStatus.CANCELED,
      REJECTED: ExchangeOrderStatus.REJECTED,
      EXPIRED: ExchangeOrderStatus.EXPIRED,
      PENDING_CANCEL: ExchangeOrderStatus.PENDING_CANCEL,
    };
    return map[status] || ExchangeOrderStatus.NEW;
  }
}

// ---------------------------------------------------------------------------
// Operator-configured venue without a dedicated adapter
// ---------------------------------------------------------------------------

/**
 * Placeholder registration for `OTHER_CONFIGURED`: an operator may list a
 * venue in the registry (URLs, environments) before an adapter for it exists.
 * It answers server time from the configured REST base when that endpoint
 * exists, and refuses every account-data call with NOT_SUPPORTED. It never
 * returns an empty list, because an empty balance/position/order list is a
 * FACT the reconciliation and risk engines act on ("the account is flat"),
 * and inventing that fact for a venue nobody can read would be fake success.
 */
class GenericExchangeProvider extends BaseExchangeProvider {
  constructor(
    public readonly venue: ExchangeVenue,
    public readonly displayName: string,
    private liveRest: string,
    private testnetRest: string,
    private sandboxRest: string,
    private liveWs: string,
    private testnetWs: string,
    private sandboxWs: string,
    public readonly supportedEnvironments: ExchangeEnvironment[],
    public readonly supportedCapabilities: ExchangeCapability[],
  ) {
    super();
  }

  protected getLiveRestUrl(): string {
    return this.liveRest;
  }
  protected getTestnetRestUrl(): string {
    return this.testnetRest;
  }
  protected getSandboxRestUrl(): string {
    return this.sandboxRest;
  }
  protected getLiveWsUrl(): string {
    return this.liveWs;
  }
  protected getTestnetWsUrl(): string {
    return this.testnetWs;
  }
  protected getSandboxWsUrl(): string {
    return this.sandboxWs;
  }

  private notSupported(context: ExchangeProviderContext, operation: string): ExchangeProviderError {
    return new ExchangeProviderError(
      ExchangeProviderErrorCode.NOT_SUPPORTED,
      `${this.displayName} (${this.venue}) has no exchange adapter: ${operation} is not available. Add a dedicated provider under exchanges/providers before connecting accounts to this venue.`,
      context.venue,
      context.environment,
      false,
    );
  }

  async getServerTime(context: ExchangeProviderContext): Promise<ExchangeServerTime> {
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/time`;
    let data: any;
    try {
      data = await this.httpGet(url);
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
    const serverTimeMs = Number(data?.serverTime ?? data?.time);
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) {
      throw this.notSupported(context, 'server time');
    }
    return this.serverTimeFromMs(serverTimeMs);
  }

  async testConnectivity(context: ExchangeProviderContext): Promise<any> {
    throw this.notSupported(context, 'connectivity verification');
  }

  async getAccountMetadata(context: ExchangeProviderContext): Promise<ExchangeAccountMetadata> {
    throw this.notSupported(context, 'account metadata');
  }

  async getCapabilities(context: ExchangeProviderContext): Promise<ExchangeCapabilityDiscovery> {
    return {
      venue: context.venue,
      environment: context.environment,
      capabilities: [],
      supportedOrderTypes: [],
      supportedEnvironments: this.supportedEnvironments,
      apiVersion: 'unknown',
      restAvailable: false,
      websocketAvailable: false,
      rateLimitModel: 'UNKNOWN',
      authenticationModel: 'UNKNOWN',
      symbolFormat: 'UNKNOWN',
      timestamp: new Date().toISOString(),
    };
  }

  async getBalances(context: ExchangeProviderContext): Promise<ExchangeBalance[]> {
    throw this.notSupported(context, 'balances');
  }

  async getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]> {
    throw this.notSupported(context, 'positions');
  }

  async getOpenOrders(context: ExchangeProviderContext, symbol?: string): Promise<ExchangeOrder[]> {
    throw this.notSupported(context, 'open orders');
  }

  async getOrderHistory(context: ExchangeProviderContext, symbol?: string, limit?: number): Promise<ExchangeOrder[]> {
    throw this.notSupported(context, 'order history');
  }

  async getTradeHistory(context: ExchangeProviderContext, symbol?: string, limit?: number): Promise<ExchangeFill[]> {
    throw this.notSupported(context, 'trade history');
  }

  async getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]> {
    throw this.notSupported(context, 'symbols');
  }
}

// ---------------------------------------------------------------------------
// Factory with registration - preserves sandbox/live separation
// ---------------------------------------------------------------------------

/**
 * Selects the configured exchange adapter from a canonical venue registry while preserving sandbox/live separation and explicit availability.
 * Requirements: venue registry lookup, environment selection, provider availability, capability validation, explicit error when adapter unavailable, no fake provider, no credential logging.
 * Do not dynamically instantiate arbitrary code from client input.
 */

@Injectable()
export class ExchangeProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(ExchangeProviderFactory.name);
  private readonly providers: Map<ExchangeVenue, ExchangeProvider> = new Map();

  constructor(private readonly registry: ExchangeRegistryService) {}

  onModuleInit() {
    // Register all supported providers on init - no dynamic code from client input
    try {
      this.registerProvider(ExchangeVenue.BINANCE, new BinanceProvider());

      const urlsOf = (entry: NonNullable<ReturnType<ExchangeRegistryService['getVenue']>>) => ({
        liveRest: entry.baseRestUrlLive,
        testnetRest: entry.baseRestUrlTestnet,
        sandboxRest: entry.baseRestUrlSandbox,
        liveWs: entry.baseWsUrlLive,
        testnetWs: entry.baseWsUrlTestnet,
        sandboxWs: entry.baseWsUrlSandbox,
      });

      const bybitEntry = this.registry.getVenue(ExchangeVenue.BYBIT);
      if (bybitEntry) {
        this.registerProvider(ExchangeVenue.BYBIT, new BybitProvider(urlsOf(bybitEntry), bybitEntry.displayName));
      }

      const okxEntry = this.registry.getVenue(ExchangeVenue.OKX);
      if (okxEntry) {
        this.registerProvider(ExchangeVenue.OKX, new OkxProvider(urlsOf(okxEntry), okxEntry.displayName));
      }

      const krakenEntry = this.registry.getVenue(ExchangeVenue.KRAKEN);
      if (krakenEntry) {
        this.registerProvider(ExchangeVenue.KRAKEN, new KrakenProvider(urlsOf(krakenEntry), krakenEntry.displayName));
      }

      const coinbaseEntry = this.registry.getVenue(ExchangeVenue.COINBASE);
      if (coinbaseEntry) {
        this.registerProvider(ExchangeVenue.COINBASE, new CoinbaseProvider(urlsOf(coinbaseEntry), coinbaseEntry.displayName));
      }

      const otherEntry = this.registry.getVenue(ExchangeVenue.OTHER_CONFIGURED);
      if (otherEntry) {
        this.registerProvider(
          ExchangeVenue.OTHER_CONFIGURED,
          new GenericExchangeProvider(
            ExchangeVenue.OTHER_CONFIGURED,
            otherEntry.displayName,
            otherEntry.baseRestUrlLive,
            otherEntry.baseRestUrlTestnet,
            otherEntry.baseRestUrlSandbox,
            otherEntry.baseWsUrlLive,
            otherEntry.baseWsUrlTestnet,
            otherEntry.baseWsUrlSandbox,
            otherEntry.supportedEnvironments,
            otherEntry.supportedCapabilities,
          ),
        );
      }

      this.logger.log(`Registered ${this.providers.size} exchange providers: ${Array.from(this.providers.keys()).join(', ')}`);
    } catch (e: any) {
      this.logger.error(`Failed to register providers: ${e.message}`);
    }
  }

  registerProvider(venue: ExchangeVenue, provider: ExchangeProvider): void {
    if (!this.registry.isVenueSupported(venue)) {
      this.logger.warn(`Attempt to register provider for unsupported venue ${venue} - allowed only if explicitly configured`);
      if (venue !== ExchangeVenue.OTHER_CONFIGURED) {
        throw new ExchangeProviderError(
          ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
          `Venue ${venue} is not supported or not active`,
          venue,
          ExchangeEnvironment.LIVE,
          false,
        );
      }
    }
    this.providers.set(venue, provider);
    this.logger.log(`Registered provider for venue ${venue} display=${provider.displayName}`);
  }

  getProvider(venue: ExchangeVenue, environment: ExchangeEnvironment): ExchangeProvider {
    const registryEntry = this.registry.getVenue(venue);
    if (!registryEntry) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
        `Unknown venue ${venue} - not in registry`,
        venue,
        environment,
        false,
      );
    }

    if (!registryEntry.isActive && venue !== ExchangeVenue.OTHER_CONFIGURED) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
        `Venue ${venue} is not active`,
        venue,
        environment,
        false,
      );
    }

    if (!this.registry.isEnvironmentSupported(venue, environment)) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.NOT_SUPPORTED,
        `Environment ${environment} not supported for venue ${venue}. Supported: ${registryEntry.supportedEnvironments.join(', ')}`,
        venue,
        environment,
        false,
      );
    }

    const provider = this.providers.get(venue);
    if (!provider) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE,
        `No provider adapter registered for venue ${venue}. Available: ${Array.from(this.providers.keys()).join(', ') || 'none'}`,
        venue,
        environment,
        false,
      );
    }

    if (!provider.supportedEnvironments.includes(environment)) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.NOT_SUPPORTED,
        `Provider for ${venue} does not support environment ${environment}. Supported: ${provider.supportedEnvironments.join(', ')}`,
        venue,
        environment,
        false,
      );
    }

    return provider;
  }

  hasProvider(venue: ExchangeVenue): boolean {
    return this.providers.has(venue);
  }

  listRegisteredVenues(): ExchangeVenue[] {
    return Array.from(this.providers.keys());
  }

  listAvailableVenues(): { venue: ExchangeVenue; displayName: string; supportedEnvironments: ExchangeEnvironment[]; isRegistered: boolean }[] {
    return this.registry.getAllVenues().map((entry) => ({
      venue: entry.venue,
      displayName: entry.displayName,
      supportedEnvironments: entry.supportedEnvironments,
      isRegistered: this.providers.has(entry.venue),
    }));
  }

  validateEnvironmentBinding(venue: ExchangeVenue, environment: ExchangeEnvironment, isSandbox: boolean): void {
    const isValid = this.registry.validateEnvironmentBinding(venue, environment, isSandbox);
    if (!isValid) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH,
        `Environment mismatch for venue ${venue}: environment=${environment} isSandbox=${isSandbox}. LIVE must have isSandbox=false, TESTNET/SANDBOX must have isSandbox=true`,
        venue,
        environment,
        false,
      );
    }
  }

  createProviderContext(
    venue: ExchangeVenue,
    environment: ExchangeEnvironment,
    isSandbox: boolean,
  ): { venue: ExchangeVenue; environment: ExchangeEnvironment; restBaseUrl: string; wsBaseUrl: string } {
    this.validateEnvironmentBinding(venue, environment, isSandbox);
    const restBaseUrl = this.registry.getRestBaseUrl(venue, environment);
    const wsBaseUrl = this.registry.getWsBaseUrl(venue, environment);

    return {
      venue,
      environment,
      restBaseUrl,
      wsBaseUrl,
    };
  }
}
