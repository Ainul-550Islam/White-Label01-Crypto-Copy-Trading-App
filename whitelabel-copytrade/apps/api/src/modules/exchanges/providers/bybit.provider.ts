// # Implements signed V5 live REST/account/symbol/health probes when live trading enabled
import * as crypto from 'crypto';
import {
  ExchangeVenue,
  ExchangeEnvironment,
  ExchangeCapability,
  ExchangeOrderType,
  ExchangeBalance,
  ExchangePosition,
  ExchangeOrder,
  ExchangeFill,
  ExchangeSymbol,
  ExchangeCapabilityDiscovery,
  ExchangePositionSide,
  ExchangeOrderStatus,
  ExchangeOrderSide,
  ExchangeConnectivityResult,
} from '../exchange.types';
import {
  ExchangeProviderError,
  ExchangeProviderErrorCode,
  ExchangeProviderContext,
  ExchangeServerTime,
  ExchangeAccountMetadata,
} from '../exchange-provider.interface';
import {
  BaseExchangeProvider,
  subtractDecimalStrings,
  absDecimalString,
  isDecimalString,
  msToMicros,
  nowMicros,
  precisionOfStep,
  canonicalFromConcatenated,
} from '../base-exchange-provider';

/** Categories this provider reads. Spot plus USDT/USDC-settled linear contracts. */
type BybitCategory = 'spot' | 'linear';

const RECV_WINDOW = '5000';
const MAX_PAGES = 10;

function dec(value: unknown): string {
  return isDecimalString(value) ? value : '0';
}

function decOrNull(value: unknown): string | null {
  return isDecimalString(value) && value !== '' ? value : null;
}

/**
 * Bybit V5 unified API, read side: server time, key permissions, wallet,
 * positions, open orders, order history, executions and instruments.
 *
 * Authentication (V5): `X-BAPI-SIGN = hex(HMAC_SHA256(secret, timestamp + apiKey + recvWindow + queryString))`.
 * Every response is an envelope `{ retCode, retMsg, result }`; a non-zero
 * retCode is a venue refusal and is classified, never read as an empty list.
 * This provider places no orders - order transmission belongs to the execution
 * engine behind the live-mode gate.
 */
export class BybitProvider extends BaseExchangeProvider {
  readonly venue = ExchangeVenue.BYBIT;
  readonly displayName: string;
  readonly supportedEnvironments: ExchangeEnvironment[] = [ExchangeEnvironment.LIVE, ExchangeEnvironment.TESTNET, ExchangeEnvironment.SANDBOX];
  readonly supportedCapabilities: ExchangeCapability[] = [
    ExchangeCapability.SPOT,
    ExchangeCapability.PERPETUALS,
    ExchangeCapability.MARKET_DATA,
    ExchangeCapability.BALANCES,
    ExchangeCapability.POSITIONS,
    ExchangeCapability.ORDERS,
    ExchangeCapability.TRADES,
    ExchangeCapability.TESTNET,
  ];

  constructor(
    private readonly urls: { liveRest: string; testnetRest: string; sandboxRest: string; liveWs: string; testnetWs: string; sandboxWs: string },
    displayName = 'Bybit',
  ) {
    super();
    this.displayName = displayName;
  }

  protected getLiveRestUrl(): string {
    return this.urls.liveRest;
  }
  protected getTestnetRestUrl(): string {
    return this.urls.testnetRest;
  }
  protected getSandboxRestUrl(): string {
    return this.urls.sandboxRest;
  }
  protected getLiveWsUrl(): string {
    return this.urls.liveWs;
  }
  protected getTestnetWsUrl(): string {
    return this.urls.testnetWs;
  }
  protected getSandboxWsUrl(): string {
    return this.urls.sandboxWs;
  }

  /** Exposed for tests: the exact V5 signature over the canonical payload. */
  static sign(secret: string, timestamp: string, apiKey: string, recvWindow: string, queryString: string): string {
    return crypto.createHmac('sha256', secret).update(timestamp + apiKey + recvWindow + queryString).digest('hex');
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  private unwrap(context: ExchangeProviderContext, data: any): any {
    if (!data || typeof data !== 'object') {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, 'Bybit returned a non-JSON body', context.venue, context.environment, true);
    }
    const code = Number(data.retCode);
    if (code === 0) return data.result ?? {};
    const message = `Bybit retCode ${data.retCode}: ${String(data.retMsg ?? '').slice(0, 200)}`;
    if ([10003, 10004, 33004, 10007].includes(code)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, message, context.venue, context.environment, false);
    }
    if ([10005, 10010].includes(code)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.PERMISSION_DENIED, message, context.venue, context.environment, false);
    }
    if (code === 10002) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.CLOCK_DRIFT, message, context.venue, context.environment, true, 1000);
    }
    if ([10006, 10018, 10429].includes(code)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.RATE_LIMITED, message, context.venue, context.environment, true, 1000);
    }
    if (code === 10001) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.INVALID_ORDER, message, context.venue, context.environment, false);
    }
    if (code === 10016) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.SERVER_ERROR, message, context.venue, context.environment, true, 1000);
    }
    throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, message, context.venue, context.environment, false);
  }

  private async publicGet(context: ExchangeProviderContext, path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
    const query = this.buildQuery(params);
    const url = `${this.getRestBaseUrlForEnv(context.environment)}${path}${query ? `?${query}` : ''}`;
    try {
      return this.unwrap(context, await this.httpGet(url));
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  private async privateGet(context: ExchangeProviderContext, path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
    this.requireCredentials(context);
    const query = this.buildQuery(params);
    const timestamp = Date.now().toString();
    const signature = BybitProvider.sign(context.credentials.apiSecret, timestamp, context.credentials.apiKey, RECV_WINDOW, query);
    const url = `${this.getRestBaseUrlForEnv(context.environment)}${path}${query ? `?${query}` : ''}`;
    try {
      const data = await this.httpGet(url, {
        'X-BAPI-API-KEY': context.credentials.apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': RECV_WINDOW,
        'X-BAPI-SIGN': signature,
      });
      return this.unwrap(context, data);
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  /** Follows `nextPageCursor` up to MAX_PAGES pages, concatenating `result.list`. */
  private async privateList(context: ExchangeProviderContext, path: string, params: Record<string, string | number | undefined>, maxItems: number): Promise<any[]> {
    const rows: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES && rows.length < maxItems; page += 1) {
      const result = await this.privateGet(context, path, { ...params, cursor });
      const list = Array.isArray(result?.list) ? result.list : [];
      rows.push(...list);
      cursor = typeof result?.nextPageCursor === 'string' && result.nextPageCursor !== '' ? result.nextPageCursor : undefined;
      if (!cursor || list.length === 0) break;
    }
    return rows.slice(0, maxItems);
  }

  async getServerTime(context: ExchangeProviderContext): Promise<ExchangeServerTime> {
    const result = await this.publicGet(context, '/v5/market/time');
    const nano = typeof result?.timeNano === 'string' && /^\d+$/.test(result.timeNano) ? BigInt(result.timeNano) : null;
    const seconds = Number(result?.timeSecond);
    const serverMs = nano !== null ? Number(nano / 1_000_000n) : seconds * 1000;
    if (!Number.isFinite(serverMs) || serverMs <= 0) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, 'Bybit server time missing from response', context.venue, context.environment, true);
    }
    return this.serverTimeFromMs(serverMs);
  }

  async testConnectivity(context: ExchangeProviderContext): Promise<ExchangeConnectivityResult> {
    return this.connectivityFromMetadata(context);
  }

  async getAccountMetadata(context: ExchangeProviderContext): Promise<ExchangeAccountMetadata> {
    const info = await this.privateGet(context, '/v5/user/query-api');
    const permissions: Record<string, string[]> = info?.permissions && typeof info.permissions === 'object' ? info.permissions : {};
    const flat = Object.entries(permissions).flatMap(([group, values]) => (Array.isArray(values) ? values.map((v) => `${group}:${v}`) : []));
    const readOnly = Number(info?.readOnly) === 1;
    const canWithdraw = (permissions['Wallet'] ?? []).some((p) => /withdraw/i.test(p));
    const canTrade =
      !readOnly &&
      ((permissions['Spot'] ?? []).includes('SpotTrade') ||
        (permissions['ContractTrade'] ?? []).length > 0 ||
        (permissions['Derivatives'] ?? []).length > 0 ||
        (permissions['Options'] ?? []).length > 0);
    const ips: string[] = Array.isArray(info?.ips) ? info.ips : [];
    return {
      accountId: context.accountId,
      venue: context.venue,
      environment: context.environment,
      isSandbox: context.isSandbox,
      canTrade,
      canRead: true,
      canWithdraw,
      ipRestricted: ips.length > 0 && !ips.includes('*'),
      permissions: flat,
      uid: info?.userID !== undefined && info?.userID !== null ? String(info.userID) : null,
      email: null,
    };
  }

  async getCapabilities(context: ExchangeProviderContext): Promise<ExchangeCapabilityDiscovery> {
    return {
      venue: context.venue,
      environment: context.environment,
      capabilities: this.supportedCapabilities,
      supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.STOP, ExchangeOrderType.STOP_LIMIT],
      supportedEnvironments: this.supportedEnvironments,
      apiVersion: 'v5',
      restAvailable: true,
      websocketAvailable: true,
      rateLimitModel: 'REQUEST_COUNT',
      authenticationModel: 'HMAC_SHA256',
      symbolFormat: 'BTCUSDT',
      timestamp: new Date().toISOString(),
    };
  }

  async getBalances(context: ExchangeProviderContext): Promise<ExchangeBalance[]> {
    const result = await this.privateGet(context, '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
    const account = Array.isArray(result?.list) ? result.list[0] : undefined;
    const coins: any[] = Array.isArray(account?.coin) ? account.coin : [];
    const timestampMicros = nowMicros();
    return coins
      .map((c) => {
        const total = dec(c.walletBalance);
        const locked = dec(c.locked);
        let free = subtractDecimalStrings(total, locked);
        if (free.startsWith('-')) free = '0';
        return {
          asset: String(c.coin),
          free,
          locked,
          total,
          providerReference: account?.accountType ? String(account.accountType) : null,
          timestampMicros,
          source: 'REST',
          isSimulated: context.isSandbox,
        };
      })
      .filter((b) => b.total !== '0' || b.locked !== '0');
  }

  async getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]> {
    const rows: any[] = [];
    for (const settleCoin of ['USDT', 'USDC']) {
      rows.push(...(await this.privateList(context, '/v5/position/list', { category: 'linear', settleCoin, limit: 200 }, 1000)));
    }
    return rows
      .filter((p) => isDecimalString(p.size) && p.size !== '0' && !/^0(\.0+)?$/.test(p.size))
      .map((p) => ({
        providerPositionId: p.positionIdx !== undefined ? `${p.symbol}:${p.positionIdx}` : null,
        symbol: canonicalFromConcatenated(p.symbol),
        exchangeSymbol: String(p.symbol),
        side: p.side === 'Buy' ? ExchangePositionSide.LONG : p.side === 'Sell' ? ExchangePositionSide.SHORT : ExchangePositionSide.FLAT,
        quantity: absDecimalString(p.size),
        entryPrice: decOrNull(p.avgPrice),
        markPrice: decOrNull(p.markPrice),
        liquidationPrice: decOrNull(p.liqPrice),
        leverage: decOrNull(p.leverage),
        unrealizedPnl: decOrNull(p.unrealisedPnl),
        realizedPnl: decOrNull(p.cumRealisedPnl),
        timestampMicros: msToMicros(p.updatedTime) ?? nowMicros(),
        isSimulated: context.isSandbox,
      }));
  }

  private categoriesFor(symbol?: string): Array<{ category: BybitCategory; settleCoin?: string }> {
    if (symbol) return [{ category: 'spot' }, { category: 'linear' }];
    return [{ category: 'spot' }, { category: 'linear', settleCoin: 'USDT' }, { category: 'linear', settleCoin: 'USDC' }];
  }

  async getOpenOrders(context: ExchangeProviderContext, symbol?: string): Promise<ExchangeOrder[]> {
    const exchangeSymbol = symbol ? symbol.replace(/[-/]/g, '').toUpperCase() : undefined;
    const rows: any[] = [];
    for (const scope of this.categoriesFor(exchangeSymbol)) {
      rows.push(...(await this.privateList(context, '/v5/order/realtime', { ...scope, symbol: exchangeSymbol, limit: 50 }, 500)));
    }
    return rows.map((o) => this.mapOrder(context, o));
  }

  async getOrderHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeOrder[]> {
    const exchangeSymbol = symbol ? symbol.replace(/[-/]/g, '').toUpperCase() : undefined;
    const rows: any[] = [];
    for (const scope of this.categoriesFor(exchangeSymbol)) {
      rows.push(...(await this.privateList(context, '/v5/order/history', { ...scope, symbol: exchangeSymbol, limit: Math.min(limit, 50) }, limit)));
    }
    return rows
      .map((o) => this.mapOrder(context, o))
      .sort((a, b) => Number(BigInt(b.createdAtMicros ?? '0') - BigInt(a.createdAtMicros ?? '0')))
      .slice(0, limit);
  }

  async getTradeHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeFill[]> {
    const exchangeSymbol = symbol ? symbol.replace(/[-/]/g, '').toUpperCase() : undefined;
    const rows: any[] = [];
    for (const scope of this.categoriesFor(exchangeSymbol)) {
      rows.push(...(await this.privateList(context, '/v5/execution/list', { ...scope, symbol: exchangeSymbol, limit: Math.min(limit, 100) }, limit)));
    }
    return rows
      .map((t) => ({
        providerTradeId: String(t.execId),
        providerOrderId: t.orderId ? String(t.orderId) : null,
        clientOrderId: t.orderLinkId ? String(t.orderLinkId) : null,
        symbol: canonicalFromConcatenated(t.symbol),
        side: t.side === 'Buy' ? ExchangeOrderSide.BUY : ExchangeOrderSide.SELL,
        price: dec(t.execPrice),
        quantity: dec(t.execQty),
        quoteQuantity: decOrNull(t.execValue),
        fee: decOrNull(t.execFee),
        feeCurrency: t.feeCurrency ? String(t.feeCurrency) : null,
        isMaker: typeof t.isMaker === 'boolean' ? t.isMaker : null,
        timestampMicros: msToMicros(t.execTime) ?? nowMicros(),
        isSimulated: context.isSandbox,
      }))
      .sort((a, b) => Number(BigInt(b.timestampMicros) - BigInt(a.timestampMicros)))
      .slice(0, limit);
  }

  async getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]> {
    const result = await this.publicGet(context, '/v5/market/instruments-info', { category: 'spot', limit: 1000 });
    const list: any[] = Array.isArray(result?.list) ? result.list : [];
    return list
      .filter((s) => s.status === 'Trading')
      .map((s) => {
        const tick = s.priceFilter?.tickSize ?? '0.00000001';
        const step = s.lotSizeFilter?.basePrecision ?? s.lotSizeFilter?.qtyStep ?? '0.00000001';
        return {
          canonicalSymbol: `${s.baseCoin}-${s.quoteCoin}`,
          exchangeSymbol: String(s.symbol),
          baseAsset: String(s.baseCoin),
          quoteAsset: String(s.quoteCoin),
          contractType: 'SPOT',
          tickSize: String(tick),
          quantityStep: String(step),
          minQuantity: decOrNull(s.lotSizeFilter?.minOrderQty),
          maxQuantity: decOrNull(s.lotSizeFilter?.maxOrderQty),
          minNotional: decOrNull(s.lotSizeFilter?.minOrderAmt),
          maxNotional: decOrNull(s.lotSizeFilter?.maxOrderAmt),
          pricePrecision: precisionOfStep(String(tick)),
          quantityPrecision: precisionOfStep(String(step)),
          minLeverage: null,
          maxLeverage: null,
          isTradeable: true,
        };
      });
  }

  private mapOrder(context: ExchangeProviderContext, o: any): ExchangeOrder {
    const hasTrigger = isDecimalString(o.triggerPrice) && !/^0(\.0+)?$/.test(o.triggerPrice);
    const isLimit = String(o.orderType) === 'Limit';
    const type = hasTrigger ? (isLimit ? ExchangeOrderType.STOP_LIMIT : ExchangeOrderType.STOP) : isLimit ? ExchangeOrderType.LIMIT : ExchangeOrderType.MARKET;
    return {
      clientOrderId: o.orderLinkId ? String(o.orderLinkId) : String(o.orderId),
      providerOrderId: o.orderId ? String(o.orderId) : null,
      symbol: canonicalFromConcatenated(o.symbol),
      exchangeSymbol: String(o.symbol),
      side: o.side === 'Buy' ? ExchangeOrderSide.BUY : ExchangeOrderSide.SELL,
      type,
      status: BybitProvider.mapOrderStatus(String(o.orderStatus)),
      providerRawStatus: o.orderStatus ? String(o.orderStatus) : null,
      quantity: dec(o.qty),
      price: isLimit ? decOrNull(o.price) : null,
      stopPrice: hasTrigger ? String(o.triggerPrice) : null,
      filledQuantity: dec(o.cumExecQty),
      averagePrice: decOrNull(o.avgPrice) === '0' ? null : decOrNull(o.avgPrice),
      fee: decOrNull(o.cumExecFee),
      feeCurrency: null,
      createdAtMicros: msToMicros(o.createdTime),
      updatedAtMicros: msToMicros(o.updatedTime),
      isSimulated: context.isSandbox,
    };
  }

  static mapOrderStatus(status: string): ExchangeOrderStatus {
    switch (status) {
      case 'New':
      case 'Created':
      case 'Untriggered':
      case 'Triggered':
      case 'Active':
        return ExchangeOrderStatus.NEW;
      case 'PartiallyFilled':
        return ExchangeOrderStatus.PARTIALLY_FILLED;
      case 'Filled':
        return ExchangeOrderStatus.FILLED;
      case 'Cancelled':
      case 'PartiallyFilledCanceled':
      case 'Deactivated':
        return ExchangeOrderStatus.CANCELED;
      case 'Rejected':
        return ExchangeOrderStatus.REJECTED;
      default:
        return ExchangeOrderStatus.NEW;
    }
  }
}
