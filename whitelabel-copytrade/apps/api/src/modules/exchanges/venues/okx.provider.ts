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
  addDecimalStrings,
  absDecimalString,
  signOfDecimalString,
  isDecimalString,
  msToMicros,
  nowMicros,
  precisionOfStep,
} from '../base-exchange-provider';

function dec(value: unknown): string {
  return isDecimalString(value) ? value : '0';
}

function decOrNull(value: unknown): string | null {
  return isDecimalString(value) ? value : null;
}

/** "BTC-USDT-SWAP" -> "BTC-USDT"; spot ids are already canonical. */
export function okxCanonical(instId: string): string {
  const parts = String(instId || '').toUpperCase().split('-');
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : String(instId || '').toUpperCase();
}

function instTypeOf(instId: string): 'SPOT' | 'SWAP' | 'FUTURES' | 'OPTION' {
  const parts = String(instId).toUpperCase().split('-');
  if (parts.length === 2) return 'SPOT';
  if (parts[2] === 'SWAP') return 'SWAP';
  if (parts.length >= 5) return 'OPTION';
  return 'FUTURES';
}

/**
 * OKX V5 API, read side.
 *
 * Authentication: `OK-ACCESS-SIGN = base64(HMAC_SHA256(secret, timestamp + METHOD + requestPath + body))`
 * where `requestPath` includes the query string and `timestamp` is ISO-8601 with
 * milliseconds; the passphrase chosen at key creation rides in
 * `OK-ACCESS-PASSPHRASE`. OKX's demo trading uses the same host with
 * `x-simulated-trading: 1`, so TESTNET/SANDBOX differ from LIVE by that header,
 * which is added for every non-LIVE environment - a demo key sent without it
 * is rejected by the venue, and a live key sent with it is too.
 */
export class OkxProvider extends BaseExchangeProvider {
  readonly venue = ExchangeVenue.OKX;
  readonly displayName: string;
  readonly supportedEnvironments: ExchangeEnvironment[] = [ExchangeEnvironment.LIVE, ExchangeEnvironment.TESTNET, ExchangeEnvironment.SANDBOX];
  readonly supportedCapabilities: ExchangeCapability[] = [
    ExchangeCapability.SPOT,
    ExchangeCapability.MARGIN,
    ExchangeCapability.FUTURES,
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
    displayName = 'OKX',
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

  /** Exposed for tests: the exact V5 prehash signature. */
  static sign(secret: string, timestamp: string, method: string, requestPath: string, body = ''): string {
    return crypto.createHmac('sha256', secret).update(timestamp + method.toUpperCase() + requestPath + body).digest('base64');
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  private demoHeaders(context: ExchangeProviderContext): Record<string, string> {
    return context.environment === ExchangeEnvironment.LIVE ? {} : { 'x-simulated-trading': '1' };
  }

  private unwrap(context: ExchangeProviderContext, data: any): any[] {
    if (!data || typeof data !== 'object') {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, 'OKX returned a non-JSON body', context.venue, context.environment, true);
    }
    const code = String(data.code);
    if (code === '0') return Array.isArray(data.data) ? data.data : [];
    const message = `OKX code ${code}: ${String(data.msg ?? '').slice(0, 200)}`;
    if (['50111', '50113', '50105', '50100', '50101', '50114'].includes(code)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, message, context.venue, context.environment, false);
    }
    if (['50110', '50120', '50121'].includes(code)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.PERMISSION_DENIED, message, context.venue, context.environment, false);
    }
    if (['50102', '50112'].includes(code)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.CLOCK_DRIFT, message, context.venue, context.environment, true, 1000);
    }
    if (['50011', '50061'].includes(code)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.RATE_LIMITED, message, context.venue, context.environment, true, 1000);
    }
    if (['50001', '50004', '50013', '50026'].includes(code)) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.SERVER_ERROR, message, context.venue, context.environment, true, 1000);
    }
    throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, message, context.venue, context.environment, false);
  }

  private async publicGet(context: ExchangeProviderContext, path: string, params: Record<string, string | number | undefined> = {}): Promise<any[]> {
    const query = this.buildQuery(params);
    const url = `${this.getRestBaseUrlForEnv(context.environment)}${path}${query ? `?${query}` : ''}`;
    try {
      return this.unwrap(context, await this.httpGet(url, this.demoHeaders(context)));
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  private async privateGet(context: ExchangeProviderContext, path: string, params: Record<string, string | number | undefined> = {}): Promise<any[]> {
    this.requireCredentials(context, true);
    const query = this.buildQuery(params);
    const requestPath = `${path}${query ? `?${query}` : ''}`;
    const timestamp = new Date().toISOString();
    const signature = OkxProvider.sign(context.credentials.apiSecret, timestamp, 'GET', requestPath);
    try {
      const data = await this.httpGet(`${this.getRestBaseUrlForEnv(context.environment)}${requestPath}`, {
        'OK-ACCESS-KEY': context.credentials.apiKey,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': context.credentials.passphrase as string,
        ...this.demoHeaders(context),
      });
      return this.unwrap(context, data);
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async getServerTime(context: ExchangeProviderContext): Promise<ExchangeServerTime> {
    const data = await this.publicGet(context, '/api/v5/public/time');
    const ts = Number(data[0]?.ts);
    if (!Number.isFinite(ts) || ts <= 0) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, 'OKX server time missing from response', context.venue, context.environment, true);
    }
    return this.serverTimeFromMs(ts);
  }

  async testConnectivity(context: ExchangeProviderContext): Promise<ExchangeConnectivityResult> {
    return this.connectivityFromMetadata(context);
  }

  async getAccountMetadata(context: ExchangeProviderContext): Promise<ExchangeAccountMetadata> {
    const data = await this.privateGet(context, '/api/v5/account/config');
    const config = data[0] ?? {};
    const perms = String(config.perm ?? '')
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);
    const ip = String(config.ip ?? '').trim();
    return {
      accountId: context.accountId,
      venue: context.venue,
      environment: context.environment,
      isSandbox: context.isSandbox,
      canTrade: perms.includes('trade'),
      canRead: perms.includes('read_only') || perms.includes('trade'),
      canWithdraw: perms.includes('withdraw'),
      ipRestricted: ip.length > 0,
      permissions: perms,
      uid: config.uid ? String(config.uid) : null,
      email: null,
    };
  }

  async getCapabilities(context: ExchangeProviderContext): Promise<ExchangeCapabilityDiscovery> {
    return {
      venue: context.venue,
      environment: context.environment,
      capabilities: this.supportedCapabilities,
      supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.LIMIT_MAKER, ExchangeOrderType.STOP, ExchangeOrderType.STOP_LIMIT],
      supportedEnvironments: this.supportedEnvironments,
      apiVersion: 'v5',
      restAvailable: true,
      websocketAvailable: true,
      rateLimitModel: 'REQUEST_COUNT',
      authenticationModel: 'HMAC_SHA256_PASSPHRASE',
      symbolFormat: 'BTC-USDT',
      timestamp: new Date().toISOString(),
    };
  }

  async getBalances(context: ExchangeProviderContext): Promise<ExchangeBalance[]> {
    const data = await this.privateGet(context, '/api/v5/account/balance');
    const details: any[] = Array.isArray(data[0]?.details) ? data[0].details : [];
    const timestampMicros = msToMicros(data[0]?.uTime) ?? nowMicros();
    return details
      .map((d) => {
        const free = dec(d.availBal);
        const locked = dec(d.frozenBal);
        const total = isDecimalString(d.cashBal) ? d.cashBal : addDecimalStrings(free, locked);
        return {
          asset: String(d.ccy),
          free,
          locked,
          total,
          providerReference: null,
          timestampMicros,
          source: 'REST',
          isSimulated: context.isSandbox,
        };
      })
      .filter((b) => b.total !== '0' || b.locked !== '0');
  }

  async getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]> {
    const data = await this.privateGet(context, '/api/v5/account/positions');
    return data
      .filter((p) => isDecimalString(p.pos) && signOfDecimalString(p.pos) !== 0)
      .map((p) => {
        let side: ExchangePositionSide;
        if (p.posSide === 'long') side = ExchangePositionSide.LONG;
        else if (p.posSide === 'short') side = ExchangePositionSide.SHORT;
        else side = signOfDecimalString(p.pos) > 0 ? ExchangePositionSide.LONG : ExchangePositionSide.SHORT;
        return {
          providerPositionId: p.posId ? String(p.posId) : null,
          symbol: okxCanonical(p.instId),
          exchangeSymbol: String(p.instId),
          side,
          quantity: absDecimalString(p.pos),
          entryPrice: decOrNull(p.avgPx),
          markPrice: decOrNull(p.markPx),
          liquidationPrice: decOrNull(p.liqPx),
          leverage: decOrNull(p.lever),
          unrealizedPnl: decOrNull(p.upl),
          realizedPnl: decOrNull(p.realizedPnl),
          timestampMicros: msToMicros(p.uTime) ?? nowMicros(),
          isSimulated: context.isSandbox,
        };
      });
  }

  async getOpenOrders(context: ExchangeProviderContext, symbol?: string): Promise<ExchangeOrder[]> {
    const params: Record<string, string | number | undefined> = { limit: 100 };
    if (symbol) {
      params.instId = symbol.toUpperCase();
      params.instType = instTypeOf(symbol);
    }
    const data = await this.privateGet(context, '/api/v5/trade/orders-pending', params);
    return data.map((o) => this.mapOrder(context, o));
  }

  async getOrderHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeOrder[]> {
    const instTypes: Array<'SPOT' | 'SWAP' | 'FUTURES' | 'OPTION'> = symbol ? [instTypeOf(symbol)] : ['SPOT', 'SWAP'];
    const rows: any[] = [];
    for (const instType of instTypes) {
      rows.push(...(await this.privateGet(context, '/api/v5/trade/orders-history', { instType, instId: symbol?.toUpperCase(), limit: Math.min(limit, 100) })));
    }
    return rows
      .map((o) => this.mapOrder(context, o))
      .sort((a, b) => Number(BigInt(b.createdAtMicros ?? '0') - BigInt(a.createdAtMicros ?? '0')))
      .slice(0, limit);
  }

  async getTradeHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeFill[]> {
    const params: Record<string, string | number | undefined> = { limit: Math.min(limit, 100) };
    if (symbol) {
      params.instId = symbol.toUpperCase();
      params.instType = instTypeOf(symbol);
    }
    const data = await this.privateGet(context, '/api/v5/trade/fills', params);
    return data.slice(0, limit).map((t) => ({
      providerTradeId: String(t.tradeId),
      providerOrderId: t.ordId ? String(t.ordId) : null,
      clientOrderId: t.clOrdId ? String(t.clOrdId) : null,
      symbol: okxCanonical(t.instId),
      side: t.side === 'buy' ? ExchangeOrderSide.BUY : ExchangeOrderSide.SELL,
      price: dec(t.fillPx),
      quantity: dec(t.fillSz),
      quoteQuantity: null,
      // OKX reports fees as negative numbers (a charge) and rebates as positive;
      // the platform's convention is a positive fee paid, so the sign flips.
      fee: isDecimalString(t.fee) ? (t.fee.startsWith('-') ? t.fee.slice(1) : t.fee === '0' ? '0' : `-${t.fee}`) : null,
      feeCurrency: t.feeCcy ? String(t.feeCcy) : null,
      isMaker: t.execType === 'M' ? true : t.execType === 'T' ? false : null,
      timestampMicros: msToMicros(t.ts) ?? nowMicros(),
      isSimulated: context.isSandbox,
    }));
  }

  async getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]> {
    const data = await this.publicGet(context, '/api/v5/public/instruments', { instType: 'SPOT' });
    return data
      .filter((s) => s.state === 'live')
      .map((s) => ({
        canonicalSymbol: `${s.baseCcy}-${s.quoteCcy}`,
        exchangeSymbol: String(s.instId),
        baseAsset: String(s.baseCcy),
        quoteAsset: String(s.quoteCcy),
        contractType: 'SPOT',
        tickSize: String(s.tickSz),
        quantityStep: String(s.lotSz),
        minQuantity: decOrNull(s.minSz),
        maxQuantity: decOrNull(s.maxLmtSz),
        minNotional: null,
        maxNotional: null,
        pricePrecision: precisionOfStep(String(s.tickSz)),
        quantityPrecision: precisionOfStep(String(s.lotSz)),
        minLeverage: null,
        maxLeverage: null,
        isTradeable: true,
      }));
  }

  private mapOrder(context: ExchangeProviderContext, o: any): ExchangeOrder {
    const ordType = String(o.ordType);
    let type: ExchangeOrderType;
    if (ordType === 'market') type = ExchangeOrderType.MARKET;
    else if (ordType === 'post_only') type = ExchangeOrderType.LIMIT_MAKER;
    else type = ExchangeOrderType.LIMIT;
    const fee = isDecimalString(o.fee) ? (o.fee.startsWith('-') ? o.fee.slice(1) : o.fee === '0' ? '0' : `-${o.fee}`) : null;
    return {
      clientOrderId: o.clOrdId ? String(o.clOrdId) : String(o.ordId),
      providerOrderId: o.ordId ? String(o.ordId) : null,
      symbol: okxCanonical(o.instId),
      exchangeSymbol: String(o.instId),
      side: o.side === 'buy' ? ExchangeOrderSide.BUY : ExchangeOrderSide.SELL,
      type,
      status: OkxProvider.mapOrderStatus(String(o.state)),
      providerRawStatus: o.state ? String(o.state) : null,
      quantity: dec(o.sz),
      price: type === ExchangeOrderType.MARKET ? null : decOrNull(o.px),
      stopPrice: null,
      filledQuantity: dec(o.accFillSz),
      averagePrice: decOrNull(o.avgPx),
      fee,
      feeCurrency: o.feeCcy ? String(o.feeCcy) : null,
      createdAtMicros: msToMicros(o.cTime),
      updatedAtMicros: msToMicros(o.uTime),
      isSimulated: context.isSandbox,
    };
  }

  static mapOrderStatus(state: string): ExchangeOrderStatus {
    switch (state) {
      case 'live':
        return ExchangeOrderStatus.NEW;
      case 'partially_filled':
        return ExchangeOrderStatus.PARTIALLY_FILLED;
      case 'filled':
        return ExchangeOrderStatus.FILLED;
      case 'canceled':
      case 'mmp_canceled':
        return ExchangeOrderStatus.CANCELED;
      default:
        return ExchangeOrderStatus.NEW;
    }
  }
}
