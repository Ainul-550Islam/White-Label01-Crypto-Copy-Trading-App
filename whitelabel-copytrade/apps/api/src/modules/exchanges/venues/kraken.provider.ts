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
  isDecimalString,
  secondsToMicros,
  nowMicros,
} from '../base-exchange-provider';

function dec(value: unknown): string {
  return isDecimalString(value) ? value : '0';
}

function decOrNull(value: unknown): string | null {
  return isDecimalString(value) ? value : null;
}

/**
 * Kraken's legacy asset codes ("XXBT", "ZUSD", "XETH") to the platform's
 * conventional tickers. Codes outside this table are returned unchanged -
 * newer Kraken assets already use plain tickers, and a staked/earn suffix
 * (".S", ".F", ".B") is kept because it is a different balance, not a typo.
 */
const KRAKEN_ASSETS: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XXDG: 'DOGE',
  XDG: 'DOGE',
  XETH: 'ETH',
  XETC: 'ETC',
  XLTC: 'LTC',
  XXLM: 'XLM',
  XXMR: 'XMR',
  XXRP: 'XRP',
  XZEC: 'ZEC',
  XMLN: 'MLN',
  XREP: 'REP',
  ZUSD: 'USD',
  ZEUR: 'EUR',
  ZGBP: 'GBP',
  ZCAD: 'CAD',
  ZJPY: 'JPY',
  ZAUD: 'AUD',
  ZCHF: 'CHF',
};

export function krakenAsset(code: string): string {
  const upper = String(code || '').toUpperCase();
  const [base, ...suffix] = upper.split('.');
  const mapped = KRAKEN_ASSETS[base] ?? base;
  return suffix.length > 0 ? `${mapped}.${suffix.join('.')}` : mapped;
}

/**
 * Splits a Kraken pair in any of its three spellings - websocket "XBT/USD",
 * legacy "XXBTZUSD" and altname "XBTUSD" - into normalized base/quote
 * tickers. Returns null when no known quote suffix matches.
 */
export function krakenPairParts(pair: string): { base: string; quote: string } | null {
  const upper = String(pair || '').toUpperCase();
  if (upper.includes('/')) {
    const [b, q] = upper.split('/');
    return b && q ? { base: krakenAsset(b), quote: krakenAsset(q) } : null;
  }
  if (upper.length === 8 && /^[XZ]/.test(upper) && /^[XZ]/.test(upper.slice(4)) && KRAKEN_ASSETS[upper.slice(4)] !== undefined) {
    return { base: krakenAsset(upper.slice(0, 4)), quote: krakenAsset(upper.slice(4)) };
  }
  for (const quote of ['USDT', 'USDC', 'ZUSD', 'ZEUR', 'ZGBP', 'ZCAD', 'ZJPY', 'USD', 'EUR', 'GBP', 'CAD', 'JPY', 'XBT', 'ETH']) {
    if (upper.length > quote.length && upper.endsWith(quote)) {
      return { base: krakenAsset(upper.slice(0, upper.length - quote.length)), quote: krakenAsset(quote) };
    }
  }
  return null;
}

/** The probe key name used to learn whether a key may withdraw. No such key exists by construction. */
export const KRAKEN_WITHDRAW_PROBE_KEY = '__wlct_permission_probe_no_such_key__';

/**
 * Kraken Spot REST API, read side.
 *
 * Authentication: `API-Sign = base64(HMAC_SHA512(base64decode(secret), uriPath || SHA256(nonce + postData)))`,
 * where `||` is byte concatenation of the path and the raw SHA-256 digest. The
 * nonce must strictly increase per key; this provider derives it from
 * microsecond wall time and never reuses one inside the process.
 *
 * Kraken has no spot sandbox, so only LIVE is supported. Kraken exposes no
 * endpoint that lists a key's permissions, so {@link getAccountMetadata}
 * PROBES them with two calls that cannot move funds or place an order:
 * `WithdrawInfo` for a withdrawal key that does not exist (answers
 * "Permission denied" only when the key lacks withdraw rights) and `AddOrder`
 * with `validate=true` (validated, never submitted). A probe that returns
 * anything other than a clean permission refusal is treated as "has the
 * permission" - fail closed, so a key we cannot prove safe is refused.
 */
export class KrakenProvider extends BaseExchangeProvider {
  readonly venue = ExchangeVenue.KRAKEN;
  readonly displayName: string;
  readonly supportedEnvironments: ExchangeEnvironment[] = [ExchangeEnvironment.LIVE];
  readonly supportedCapabilities: ExchangeCapability[] = [
    ExchangeCapability.SPOT,
    ExchangeCapability.MARGIN,
    ExchangeCapability.MARKET_DATA,
    ExchangeCapability.BALANCES,
    ExchangeCapability.POSITIONS,
    ExchangeCapability.ORDERS,
    ExchangeCapability.TRADES,
  ];

  private lastNonce = 0n;

  constructor(
    private readonly urls: { liveRest: string; liveWs: string },
    displayName = 'Kraken',
  ) {
    super();
    this.displayName = displayName;
  }

  protected getLiveRestUrl(): string {
    return this.urls.liveRest;
  }
  protected getTestnetRestUrl(): string {
    return this.urls.liveRest;
  }
  protected getSandboxRestUrl(): string {
    return this.urls.liveRest;
  }
  protected getLiveWsUrl(): string {
    return this.urls.liveWs;
  }
  protected getTestnetWsUrl(): string {
    return this.urls.liveWs;
  }
  protected getSandboxWsUrl(): string {
    return this.urls.liveWs;
  }

  /** Exposed for tests: the exact Kraken signature. */
  static sign(secretBase64: string, uriPath: string, nonce: string, postData: string): string {
    const digest = crypto.createHash('sha256').update(nonce + postData).digest();
    return crypto
      .createHmac('sha512', Buffer.from(secretBase64, 'base64'))
      .update(Buffer.concat([Buffer.from(uriPath, 'utf8'), digest]))
      .digest('base64');
  }

  private nextNonce(): string {
    const candidate = BigInt(Date.now()) * 1000n;
    this.lastNonce = candidate > this.lastNonce ? candidate : this.lastNonce + 1n;
    return this.lastNonce.toString();
  }

  private assertLive(context: ExchangeProviderContext): void {
    if (context.environment !== ExchangeEnvironment.LIVE) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.NOT_SUPPORTED,
        'Kraken has no spot sandbox or testnet; only LIVE accounts can be connected',
        context.venue,
        context.environment,
        false,
      );
    }
  }

  private classify(context: ExchangeProviderContext, errors: string[]): ExchangeProviderError {
    const joined = errors.join('; ').slice(0, 300);
    const has = (needle: string) => errors.some((e) => e.includes(needle));
    if (has('EAPI:Invalid key') || has('EAPI:Invalid signature')) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, `Kraken: ${joined}`, context.venue, context.environment, false);
    }
    if (has('EAPI:Invalid nonce')) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.CLOCK_DRIFT, `Kraken: ${joined}`, context.venue, context.environment, true, 1000);
    }
    if (has('EGeneral:Permission denied')) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.PERMISSION_DENIED, `Kraken: ${joined}`, context.venue, context.environment, false);
    }
    if (has('Rate limit exceeded') || has('EGeneral:Too many requests')) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.RATE_LIMITED, `Kraken: ${joined}`, context.venue, context.environment, true, 2000);
    }
    if (has('EService:Unavailable') || has('EService:Busy') || has('EService:Market in cancel_only mode')) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.SERVER_ERROR, `Kraken: ${joined}`, context.venue, context.environment, true, 2000);
    }
    if (has('EQuery:Unknown asset pair')) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.SYMBOL_NOT_FOUND, `Kraken: ${joined}`, context.venue, context.environment, false);
    }
    return new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, `Kraken: ${joined}`, context.venue, context.environment, false);
  }

  private unwrap(context: ExchangeProviderContext, data: any): any {
    if (!data || typeof data !== 'object') {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, 'Kraken returned a non-JSON body', context.venue, context.environment, true);
    }
    const errors: string[] = Array.isArray(data.error) ? data.error.map(String) : [];
    if (errors.length > 0) throw this.classify(context, errors);
    return data.result ?? {};
  }

  private async publicGet(context: ExchangeProviderContext, path: string, query = ''): Promise<any> {
    this.assertLive(context);
    try {
      return this.unwrap(context, await this.httpGet(`${this.getLiveRestUrl()}${path}${query ? `?${query}` : ''}`));
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  private async privatePost(context: ExchangeProviderContext, path: string, params: Record<string, string> = {}): Promise<any> {
    this.assertLive(context);
    this.requireCredentials(context);
    const nonce = this.nextNonce();
    const postData = new URLSearchParams({ nonce, ...params }).toString();
    const signature = KrakenProvider.sign(context.credentials.apiSecret, path, nonce, postData);
    try {
      const data = await this.httpRequest({
        method: 'POST',
        url: `${this.getLiveRestUrl()}${path}`,
        headers: {
          'API-Key': context.credentials.apiKey,
          'API-Sign': signature,
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body: postData,
      });
      return this.unwrap(context, data);
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async getServerTime(context: ExchangeProviderContext): Promise<ExchangeServerTime> {
    const result = await this.publicGet(context, '/0/public/Time');
    const seconds = Number(result?.unixtime);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, 'Kraken server time missing from response', context.venue, context.environment, true);
    }
    // Kraken's clock has one-second resolution; drift below a second is noise.
    return this.serverTimeFromMs(seconds * 1000);
  }

  async testConnectivity(context: ExchangeProviderContext): Promise<ExchangeConnectivityResult> {
    return this.connectivityFromMetadata(context);
  }

  /** true = the probe proved the permission is ABSENT; false = present or unprovable. */
  private async probeRefused(context: ExchangeProviderContext, path: string, params: Record<string, string>): Promise<boolean> {
    try {
      await this.privatePost(context, path, params);
      return false;
    } catch (e: any) {
      if (e instanceof ExchangeProviderError && e.code === ExchangeProviderErrorCode.PERMISSION_DENIED) return true;
      if (e instanceof ExchangeProviderError && (e.code === ExchangeProviderErrorCode.AUTH_FAILED || e.code === ExchangeProviderErrorCode.RATE_LIMITED)) throw e;
      return false;
    }
  }

  async getAccountMetadata(context: ExchangeProviderContext): Promise<ExchangeAccountMetadata> {
    // The read permission is proven by an ordinary balance read (throws on a bad key).
    await this.privatePost(context, '/0/private/Balance');
    const withdrawRefused = await this.probeRefused(context, '/0/private/WithdrawInfo', {
      asset: 'XBT',
      key: KRAKEN_WITHDRAW_PROBE_KEY,
      amount: '0.0001',
    });
    const tradeRefused = await this.probeRefused(context, '/0/private/AddOrder', {
      pair: 'XBTUSD',
      type: 'buy',
      ordertype: 'limit',
      price: '1',
      volume: '0.0001',
      validate: 'true',
    });
    const permissions = ['query_funds'];
    if (!tradeRefused) permissions.push('create_modify_orders');
    if (!withdrawRefused) permissions.push('withdraw_funds_or_unproven');
    return {
      accountId: context.accountId,
      venue: context.venue,
      environment: context.environment,
      isSandbox: context.isSandbox,
      canTrade: !tradeRefused,
      canRead: true,
      canWithdraw: !withdrawRefused,
      ipRestricted: false,
      permissions,
      uid: null,
      email: null,
    };
  }

  async getCapabilities(context: ExchangeProviderContext): Promise<ExchangeCapabilityDiscovery> {
    return {
      venue: context.venue,
      environment: context.environment,
      capabilities: this.supportedCapabilities,
      supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.STOP, ExchangeOrderType.STOP_LIMIT, ExchangeOrderType.TAKE_PROFIT, ExchangeOrderType.TAKE_PROFIT_LIMIT],
      supportedEnvironments: this.supportedEnvironments,
      apiVersion: '0',
      restAvailable: true,
      websocketAvailable: true,
      rateLimitModel: 'TOKEN_BUCKET',
      authenticationModel: 'HMAC_SHA512',
      symbolFormat: 'XBTUSD',
      timestamp: new Date().toISOString(),
    };
  }

  async getBalances(context: ExchangeProviderContext): Promise<ExchangeBalance[]> {
    const result = await this.privatePost(context, '/0/private/BalanceEx');
    const timestampMicros = nowMicros();
    return Object.entries(result as Record<string, any>)
      .map(([code, row]) => {
        const total = dec(row?.balance);
        const locked = dec(row?.hold_trade);
        let free = subtractDecimalStrings(total, locked);
        if (free.startsWith('-')) free = '0';
        return {
          asset: krakenAsset(code),
          free,
          locked,
          total,
          providerReference: code,
          timestampMicros,
          source: 'REST',
          isSimulated: false,
        };
      })
      .filter((b) => !/^0(\.0+)?$/.test(b.total) || !/^0(\.0+)?$/.test(b.locked));
  }

  async getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]> {
    const result = await this.privatePost(context, '/0/private/OpenPositions', { docalcs: 'true' });
    return Object.entries(result as Record<string, any>).map(([posId, p]) => {
      const vol = dec(p?.vol);
      const closed = dec(p?.vol_closed);
      const open = subtractDecimalStrings(vol, closed);
      return {
        providerPositionId: posId,
        symbol: this.canonicalPair(String(p?.pair ?? '')),
        exchangeSymbol: String(p?.pair ?? ''),
        side: p?.type === 'sell' ? ExchangePositionSide.SHORT : ExchangePositionSide.LONG,
        quantity: open.startsWith('-') ? '0' : open,
        entryPrice: null,
        markPrice: null,
        liquidationPrice: null,
        leverage: decOrNull(p?.leverage),
        unrealizedPnl: decOrNull(p?.net),
        realizedPnl: null,
        timestampMicros: secondsToMicros(p?.time) ?? nowMicros(),
        isSimulated: false,
      };
    });
  }

  async getOpenOrders(context: ExchangeProviderContext, symbol?: string): Promise<ExchangeOrder[]> {
    const result = await this.privatePost(context, '/0/private/OpenOrders');
    const orders = Object.entries((result?.open ?? {}) as Record<string, any>).map(([txid, o]) => this.mapOrder(txid, o));
    return symbol ? orders.filter((o) => o.symbol === symbol.toUpperCase() || o.exchangeSymbol === symbol.toUpperCase()) : orders;
  }

  async getOrderHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeOrder[]> {
    const result = await this.privatePost(context, '/0/private/ClosedOrders');
    const orders = Object.entries((result?.closed ?? {}) as Record<string, any>)
      .map(([txid, o]) => this.mapOrder(txid, o))
      .filter((o) => !symbol || o.symbol === symbol.toUpperCase() || o.exchangeSymbol === symbol.toUpperCase())
      .sort((a, b) => Number(BigInt(b.createdAtMicros ?? '0') - BigInt(a.createdAtMicros ?? '0')));
    return orders.slice(0, limit);
  }

  async getTradeHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeFill[]> {
    const result = await this.privatePost(context, '/0/private/TradesHistory');
    return Object.entries((result?.trades ?? {}) as Record<string, any>)
      .map(([tradeId, t]) => ({
        providerTradeId: tradeId,
        providerOrderId: t?.ordertxid ? String(t.ordertxid) : null,
        clientOrderId: null,
        symbol: this.canonicalPair(String(t?.pair ?? '')),
        side: t?.type === 'sell' ? ExchangeOrderSide.SELL : ExchangeOrderSide.BUY,
        price: dec(t?.price),
        quantity: dec(t?.vol),
        quoteQuantity: decOrNull(t?.cost),
        fee: decOrNull(t?.fee),
        feeCurrency: null,
        isMaker: typeof t?.maker === 'boolean' ? t.maker : null,
        timestampMicros: secondsToMicros(t?.time) ?? nowMicros(),
        isSimulated: false,
      }))
      .filter((f) => !symbol || f.symbol === symbol.toUpperCase())
      .sort((a, b) => Number(BigInt(b.timestampMicros) - BigInt(a.timestampMicros)))
      .slice(0, limit);
  }

  async getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]> {
    const result = await this.publicGet(context, '/0/public/AssetPairs');
    return Object.entries(result as Record<string, any>)
      .filter(([, p]) => (p?.status ?? 'online') === 'online' && typeof p?.wsname === 'string')
      .map(([pairKey, p]) => {
        const [wsBase, wsQuote] = String(p.wsname).split('/');
        const base = krakenAsset(wsBase);
        const quote = krakenAsset(wsQuote);
        const pairDecimals = Number(p.pair_decimals ?? 8);
        const lotDecimals = Number(p.lot_decimals ?? 8);
        return {
          canonicalSymbol: `${base}-${quote}`,
          exchangeSymbol: String(p.altname ?? pairKey),
          baseAsset: base,
          quoteAsset: quote,
          contractType: 'SPOT',
          tickSize: isDecimalString(p.tick_size) ? p.tick_size : lotStep(pairDecimals),
          quantityStep: lotStep(lotDecimals),
          minQuantity: decOrNull(p.ordermin),
          maxQuantity: null,
          minNotional: decOrNull(p.costmin),
          maxNotional: null,
          pricePrecision: pairDecimals,
          quantityPrecision: lotDecimals,
          minLeverage: null,
          maxLeverage: Array.isArray(p.leverage_buy) && p.leverage_buy.length > 0 ? Math.max(...p.leverage_buy.map(Number)) : null,
          isTradeable: true,
        };
      });
  }

  /** "XXBTZUSD" / "XBTUSD" / "XBT/USD" -> "BTC-USD" using the legacy asset table. */
  canonicalPair(pair: string): string {
    const parts = krakenPairParts(pair);
    return parts ? `${parts.base}-${parts.quote}` : pair.toUpperCase();
  }

  private mapOrder(txid: string, o: any): ExchangeOrder {
    const descr = o?.descr ?? {};
    const ordertype = String(descr.ordertype ?? '');
    const typeMap: Record<string, ExchangeOrderType> = {
      market: ExchangeOrderType.MARKET,
      limit: ExchangeOrderType.LIMIT,
      'stop-loss': ExchangeOrderType.STOP,
      'stop-loss-limit': ExchangeOrderType.STOP_LIMIT,
      'take-profit': ExchangeOrderType.TAKE_PROFIT,
      'take-profit-limit': ExchangeOrderType.TAKE_PROFIT_LIMIT,
    };
    const type = typeMap[ordertype] ?? ExchangeOrderType.LIMIT;
    const isStopFamily = type === ExchangeOrderType.STOP || type === ExchangeOrderType.STOP_LIMIT || type === ExchangeOrderType.TAKE_PROFIT || type === ExchangeOrderType.TAKE_PROFIT_LIMIT;
    const pair = String(descr.pair ?? '');
    const volExec = dec(o?.vol_exec);
    return {
      clientOrderId: o?.cl_ord_id ? String(o.cl_ord_id) : o?.userref ? String(o.userref) : txid,
      providerOrderId: txid,
      symbol: this.canonicalPair(pair),
      exchangeSymbol: pair,
      side: descr.type === 'sell' ? ExchangeOrderSide.SELL : ExchangeOrderSide.BUY,
      type,
      status: KrakenProvider.mapOrderStatus(String(o?.status ?? ''), volExec),
      providerRawStatus: o?.status ? String(o.status) : null,
      quantity: dec(o?.vol),
      price: type === ExchangeOrderType.MARKET ? null : isStopFamily ? decOrNull(descr.price2) : decOrNull(descr.price),
      stopPrice: isStopFamily ? decOrNull(descr.price) : null,
      filledQuantity: volExec,
      averagePrice: isDecimalString(o?.price) && !/^0(\.0+)?$/.test(o.price) ? o.price : null,
      fee: decOrNull(o?.fee),
      feeCurrency: null,
      createdAtMicros: secondsToMicros(o?.opentm),
      updatedAtMicros: secondsToMicros(o?.closetm) ?? secondsToMicros(o?.opentm),
      isSimulated: false,
    };
  }

  static mapOrderStatus(status: string, volExec = '0'): ExchangeOrderStatus {
    const executed = !/^0(\.0+)?$/.test(volExec);
    switch (status) {
      case 'pending':
      case 'open':
        return executed ? ExchangeOrderStatus.PARTIALLY_FILLED : ExchangeOrderStatus.NEW;
      case 'closed':
        return ExchangeOrderStatus.FILLED;
      case 'canceled':
        return ExchangeOrderStatus.CANCELED;
      case 'expired':
        return ExchangeOrderStatus.EXPIRED;
      default:
        return ExchangeOrderStatus.NEW;
    }
  }
}

function lotStep(decimals: number): string {
  if (!Number.isInteger(decimals) || decimals <= 0) return '1';
  return `0.${'0'.repeat(decimals - 1)}1`;
}
