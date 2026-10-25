// # Responsibility: select explicit venue/environment adapters and runtime-narrow untrusted REST payloads without financial defaults, raw error leaks or any-based schema bypasses.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ExchangeVenue, ExchangeEnvironment, ExchangeCapability, ExchangeOrderType, ExchangeBalance, ExchangePosition, ExchangeOrder, ExchangeFill, ExchangeSymbol, ExchangeCapabilityDiscovery, ExchangePositionSide, ExchangeOrderStatus, ExchangeOrderSide, type ExchangeConnectivityResult } from './exchange.types';
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


function jsonRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed venue object response');
  const result: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: item, enumerable: true });
  return result;
}
function jsonRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Malformed venue array response');
  const rows: unknown[] = value; return rows.map(jsonRecord);
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing venue ${label}`); return value;
}
function decimal(value: unknown, label: string): string {
  if (!isDecimalString(value)) throw new Error(`Invalid exact venue ${label}`); return value;
}
function optionalDecimal(value: unknown, label: string): string | null { return value === null || value === undefined ? null : decimal(value, label); }
function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid venue ${label}`); return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value.toString();
  throw new Error(`Invalid venue ${label}`);
}
function timestampMicros(value: unknown): string {
  const milliseconds = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return (BigInt(count(milliseconds, 'millisecond timestamp')) * 1000n).toString();
}
function option<T extends string>(value: unknown, values: readonly T[], label: string): T {
  const result = values.find((candidate) => candidate === value); if (!result) throw new Error(`Unsupported venue ${label}`); return result;
}
function boolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') throw new Error(`Unobserved venue ${label}`); return value; }
function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Missing venue ${label}`); const items: unknown[] = value; return items.map((item) => text(item, label));
}
function failureKind(error: unknown): string { return error instanceof Error ? error.constructor.name : 'UnknownError'; }

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
    try {
      const raw: unknown = await this.httpGet(url);
      const data = jsonRecord(raw);
      const serverTimeMs = count(data.serverTime, 'server time');
      const localMs = Date.now();
      const drift = localMs - serverTimeMs;
      return {
        serverTimeMicros: (BigInt(serverTimeMs) * BigInt(1000)).toString(),
        localTimeMicros: (BigInt(localMs) * BigInt(1000)).toString(),
        driftMs: drift,
      };
    } catch (e) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async testConnectivity(context: ExchangeProviderContext): Promise<ExchangeConnectivityResult> {
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
      const raw: unknown = await this.httpGet(url, headers);
      const data = jsonRecord(raw);
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
        permissions: strings(data.permissions, 'permissions'),
        uid: null,
        email: null,
      };
    } catch (e) {
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
      const raw: unknown = await this.httpGet(url, headers);
      const data = jsonRecord(raw);
      return jsonRows(data.balances).map((balance): ExchangeBalance => {
        const free = decimal(balance.free, 'free balance'); const locked = decimal(balance.locked, 'locked balance');
        if (signOfDecimalString(free) < 0 || signOfDecimalString(locked) < 0) throw new Error('Negative venue spot balance');
        return { asset: text(balance.asset, 'asset'), free, locked, total: addDecimalStrings(free, locked), providerReference: null,
          timestampMicros: (BigInt(Date.now()) * 1000n).toString(), source: 'REST', isSimulated: context.isSandbox };
      }).filter((balance) => signOfDecimalString(balance.free) > 0 || signOfDecimalString(balance.locked) > 0);
    } catch (e) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  /** USD-M futures are served from their own host, never from the spot REST base. */
  private futuresBaseUrl(environment: ExchangeEnvironment): string {
    return environment === ExchangeEnvironment.LIVE ? 'https://fapi.binance.com' : 'https://testnet.binancefuture.com';
  }

  async getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]> {
    // Binance spot has no positions; USD-M futures does. A key without futures
    // enabled may be answered 401/403 (-2015) by the futures host. That is
    // unavailable evidence, not proof that the account is flat. Permission,
    // network, rate-limit, server and clock failures therefore propagate.
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = this.sign(query, context.credentials.apiSecret);
    const url = `${this.futuresBaseUrl(context.environment)}/fapi/v2/positionRisk?${query}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': context.credentials.apiKey };
    let data: unknown;
    try {
      data = await this.httpGet(url, headers);
    } catch (e) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
    return jsonRows(data).map((position): ExchangePosition | null => {
      const amount = decimal(position.positionAmt, 'position amount');
      if (signOfDecimalString(amount) === 0) return null;
      const symbol = text(position.symbol, 'position symbol');
      return { providerPositionId: null, symbol: canonicalFromConcatenated(symbol), exchangeSymbol: symbol,
        side: signOfDecimalString(amount) > 0 ? ExchangePositionSide.LONG : ExchangePositionSide.SHORT, quantity: absDecimalString(amount),
        entryPrice: decimal(position.entryPrice, 'entry price'), markPrice: optionalDecimal(position.markPrice, 'mark price'),
        liquidationPrice: optionalDecimal(position.liquidationPrice, 'liquidation price'), leverage: optionalDecimal(position.leverage, 'leverage'),
        unrealizedPnl: optionalDecimal(position.unRealizedProfit, 'unrealized PnL'), realizedPnl: null,
        timestampMicros: (BigInt(Date.now()) * 1000n).toString(), isSimulated: context.isSandbox };
    }).filter((position): position is ExchangePosition => position !== null);
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
      const raw: unknown = await this.httpGet(url, headers);
      return jsonRows(raw).map((order) => this.parseOrder(order, context));
    } catch (e) {
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
      const raw: unknown = await this.httpGet(url, headers);
      return jsonRows(raw).map((order) => this.parseOrder(order, context));
    } catch (e) {
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
      const raw: unknown = await this.httpGet(url, headers);
      return jsonRows(raw).map((trade): ExchangeFill => ({
        providerTradeId: identifier(trade.id, 'trade id'), providerOrderId: trade.orderId === null || trade.orderId === undefined ? null : identifier(trade.orderId, 'order id'),
        clientOrderId: null, symbol: canonicalFromConcatenated(text(trade.symbol, 'trade symbol')),
        side: boolean(trade.isBuyer, 'buyer side') ? ExchangeOrderSide.BUY : ExchangeOrderSide.SELL,
        price: decimal(trade.price, 'fill price'), quantity: decimal(trade.qty, 'fill quantity'), quoteQuantity: optionalDecimal(trade.quoteQty, 'quote quantity'),
        fee: decimal(trade.commission, 'commission'), feeCurrency: text(trade.commissionAsset, 'fee currency'), isMaker: boolean(trade.isMaker, 'maker flag'),
        timestampMicros: timestampMicros(trade.time), isSimulated: context.isSandbox,
      }));
    } catch (e) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]> {
    const url = `${this.getRestBaseUrlForEnv(context.environment)}/api/v3/exchangeInfo`;
    try {
      const raw: unknown = await this.httpGet(url); const data = jsonRecord(raw);
      return jsonRows(data.symbols).filter((symbol) => symbol.status === 'TRADING').map((symbol): ExchangeSymbol => {
        const filters = jsonRows(symbol.filters); const lot = filters.find((filter) => filter.filterType === 'LOT_SIZE');
        const price = filters.find((filter) => filter.filterType === 'PRICE_FILTER'); const notional = filters.find((filter) => filter.filterType === 'MIN_NOTIONAL' || filter.filterType === 'NOTIONAL');
        if (!lot || !price) throw new Error('Required venue tick/quantity filters unavailable');
        const baseAsset = text(symbol.baseAsset, 'base asset'); const quoteAsset = text(symbol.quoteAsset, 'quote asset');
        const tickSize = decimal(price.tickSize, 'tick size'); const quantityStep = decimal(lot.stepSize, 'quantity step');
        if (signOfDecimalString(tickSize) <= 0 || signOfDecimalString(quantityStep) <= 0) throw new Error('Positive venue tick/quantity constraints required');
        return { canonicalSymbol: `${baseAsset}-${quoteAsset}`, exchangeSymbol: text(symbol.symbol, 'symbol'), baseAsset, quoteAsset, contractType: 'SPOT',
          tickSize, quantityStep, minQuantity: optionalDecimal(lot.minQty, 'minimum quantity'), maxQuantity: optionalDecimal(lot.maxQty, 'maximum quantity'),
          minNotional: optionalDecimal(notional?.minNotional, 'minimum notional'), maxNotional: optionalDecimal(notional?.maxNotional, 'maximum notional'),
          pricePrecision: count(symbol.quotePrecision, 'quote precision'), quantityPrecision: count(symbol.baseAssetPrecision, 'base precision'),
          minLeverage: null, maxLeverage: null, isTradeable: true };
      });
    } catch (e) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  private parseOrder(order: Record<string, unknown>, context: ExchangeProviderContext): ExchangeOrder {
    const symbol = text(order.symbol, 'order symbol'); const rawStatus = text(order.status, 'order status');
    const type = order.type === 'STOP_LOSS' ? ExchangeOrderType.STOP : order.type === 'STOP_LOSS_LIMIT' ? ExchangeOrderType.STOP_LIMIT : option(order.type, Object.values(ExchangeOrderType), 'order type');
    return { clientOrderId: text(order.clientOrderId, 'client order id'), providerOrderId: identifier(order.orderId, 'order id'),
      symbol: canonicalFromConcatenated(symbol), exchangeSymbol: symbol, side: option(order.side, Object.values(ExchangeOrderSide), 'order side'), type,
      status: this.mapOrderStatus(rawStatus), providerRawStatus: rawStatus, quantity: decimal(order.origQty, 'order quantity'),
      price: optionalDecimal(order.price, 'order price'), stopPrice: optionalDecimal(order.stopPrice, 'stop price'), filledQuantity: decimal(order.executedQty, 'filled quantity'),
      averagePrice: null, fee: null, feeCurrency: null,
      createdAtMicros: order.time === null || order.time === undefined ? null : timestampMicros(order.time),
      updatedAtMicros: order.updateTime === null || order.updateTime === undefined ? null : timestampMicros(order.updateTime), isSimulated: context.isSandbox };
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
    const mapped = map[status]; if (!mapped) throw new Error('Unknown venue order status'); return mapped;
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
    let data: unknown;
    try {
      data = await this.httpGet(url);
    } catch (e) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
    const body = jsonRecord(data); const serverTimeMs = count(body.serverTime ?? body.time, 'server time');
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) {
      throw this.notSupported(context, 'server time');
    }
    return this.serverTimeFromMs(serverTimeMs);
  }

  async testConnectivity(context: ExchangeProviderContext): Promise<ExchangeConnectivityResult> {
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

  async getOpenOrders(context: ExchangeProviderContext): Promise<ExchangeOrder[]> {
    throw this.notSupported(context, 'open orders');
  }

  async getOrderHistory(context: ExchangeProviderContext): Promise<ExchangeOrder[]> {
    throw this.notSupported(context, 'order history');
  }

  async getTradeHistory(context: ExchangeProviderContext): Promise<ExchangeFill[]> {
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
    } catch (e) {
      this.logger.error(`Failed to register providers: ${failureKind(e)}`);
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
